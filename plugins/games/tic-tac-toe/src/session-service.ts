import type { Database, Models, RelatedModel } from '@zhin.js/core';
import {
  BaseSessionService,
  channelKey,
  generateCompactId,
  type GameMessageLike,
  type GameSessionDatabase,
} from '@zhin.js/game-kit';
import type { TttModelName, TttSessionRow } from './models.js';
import { BOT_ID } from './player-label.js';

/** 井字棋服务使用的数据库实例（Models 经 models.ts 模块增强） */
export type TttDatabase = Database<unknown, Models, string>;

type TttModel<K extends TttModelName> = RelatedModel<unknown, Models, K>;

export type TttPlayerRef = { id: string; displayName: string };

/** 排队行过期时间（超时未匹配的排队视为失效） */
export const QUEUE_TTL_MS = 10 * 60 * 1000;

function getModel<K extends TttModelName>(db: TttDatabase, name: K): TttModel<K> {
  const model = db.models.get(name);
  if (!model) {
    throw new Error(`Model ${name} is not registered`);
  }
  return model as TttModel<K>;
}

export class QueueService {
  constructor(private readonly db: TttDatabase) {}

  /** 清掉频道内过期排队行（ttt_queue 无 TTL，靠 join 时顺带清理） */
  private async pruneExpired(channel: string): Promise<void> {
    const q = getModel(this.db, 'ttt_queue');
    const cutoff = Date.now() - QUEUE_TTL_MS;
    const rows = await q.findAll({ channel_key: channel });
    for (const row of rows) {
      if (row.joined_at < cutoff) {
        await q.deleteWhere({ channel_key: channel, user_id: row.user_id });
      }
    }
  }

  async join(
    channel: string,
    userId: string,
    displayName?: string,
  ): Promise<{ queued: boolean; position: number }> {
    const q = getModel(this.db, 'ttt_queue');
    await this.pruneExpired(channel);
    const existing = await q.findAll({ channel_key: channel, user_id: userId });
    const all = await q.findAll({ channel_key: channel });
    all.sort((a, b) => a.joined_at - b.joined_at);
    if (existing.length > 0) {
      return { queued: true, position: all.findIndex((r) => r.user_id === userId) + 1 };
    }
    const name = displayName?.trim() || '';
    await q.create({ channel_key: channel, user_id: userId, user_name: name, joined_at: Date.now() });
    const after = await q.findAll({ channel_key: channel });
    after.sort((a, b) => a.joined_at - b.joined_at);
    return { queued: true, position: after.length };
  }

  async leave(channel: string, userId: string): Promise<boolean> {
    const q = getModel(this.db, 'ttt_queue');
    const rows = await q.findAll({ channel_key: channel, user_id: userId });
    if (rows.length === 0) return false;
    await q.deleteWhere({ channel_key: channel, user_id: userId });
    return true;
  }

  async list(channel: string): Promise<string[]> {
    const rows = await getModel(this.db, 'ttt_queue').findAll({ channel_key: channel });
    return rows.map((r) => r.user_id);
  }

  async tryMatch(channel: string): Promise<[TttPlayerRef, TttPlayerRef] | null> {
    const q = getModel(this.db, 'ttt_queue');
    const rows = await q.findAll({ channel_key: channel });
    rows.sort((a, b) => a.joined_at - b.joined_at);
    if (rows.length < 2) return null;
    // 只删除匹配到的两人，保留队列中其余的等待者
    await q.deleteWhere({ channel_key: channel, user_id: rows[0]!.user_id });
    await q.deleteWhere({ channel_key: channel, user_id: rows[1]!.user_id });
    const toRef = (userId: string, userName: string) => ({
      id: userId,
      displayName: userName.trim() || userId,
    });
    return [
      toRef(rows[0]!.user_id, rows[0]!.user_name),
      toRef(rows[1]!.user_id, rows[1]!.user_name),
    ];
  }

  async count(channel: string): Promise<number> {
    const rows = await getModel(this.db, 'ttt_queue').findAll({ channel_key: channel });
    return rows.length;
  }
}

export function sessionId(): string {
  return generateCompactId('s');
}

export class SessionService extends BaseSessionService<TttSessionRow> {
  constructor(private readonly db: TttDatabase) {
    super(db as unknown as GameSessionDatabase<TttSessionRow>, {
      gameId: 'ttt',
      table: 'ttt_sessions',
      userFields: ['player_x', 'player_o'],
      projectOutcomes: (session) => {
        if (session.status !== 'won' && session.status !== 'draw') return [];
        return [
          {
            id: session.player_x,
            name: session.player_x_name,
            mark: 1,
          },
          {
            id: session.player_o,
            name: session.player_o_name,
            mark: 2,
          },
        ]
          .filter((player) => player.id !== BOT_ID)
          .map((player) => ({
            userId: player.id,
            userName: player.name,
            result: session.status === 'draw'
              ? 'draw' as const
              : session.winner === player.mark
                ? 'won' as const
                : 'lost' as const,
            score: session.status === 'won' && session.winner === player.mark
              ? 20
              : undefined,
          }));
      },
    });
  }

  async createSession(input: {
    message: GameMessageLike;
    playerX: string;
    playerO: string;
    playerXName?: string;
    playerOName?: string;
    boardJson: string;
  }): Promise<TttSessionRow> {
    const now = Date.now();
    const id = sessionId();
    const ch = channelKey(input.message);
    const row: TttSessionRow = {
      id,
      adapter: String(input.message.$adapter),
      endpoint: input.message.$endpoint,
      channel_type: input.message.$channel.type,
      channel_id: input.message.$channel.id,
      channel_key: ch,
      player_x: input.playerX,
      player_o: input.playerO,
      player_x_name: input.playerXName?.trim() || input.playerX,
      player_o_name: input.playerOName?.trim() || input.playerO,
      board: input.boardJson,
      turn: 1,
      status: 'active',
      winner: 0,
      move_count: 0,
      updated_at: now,
      created_at: now,
    };
    return this.createRow(row);
  }

  async recordMove(sessionId: string, playerId: string, cell: number, moveIndex: number): Promise<void> {
    await getModel(this.db, 'ttt_moves').create({
      session_id: sessionId,
      player_id: playerId,
      cell,
      move_index: moveIndex,
      created_at: Date.now(),
    });
  }

  async addSpectator(sessionId: string, userId: string): Promise<void> {
    const sp = getModel(this.db, 'ttt_spectators');
    const existing = await sp.findOne({ session_id: sessionId, user_id: userId });
    if (existing) return;
    await sp.create({ session_id: sessionId, user_id: userId, joined_at: Date.now() });
  }

  async listSpectators(sessionId: string): Promise<string[]> {
    const rows = await getModel(this.db, 'ttt_spectators').findAll({ session_id: sessionId });
    return rows.map((r) => r.user_id);
  }

}

export type SessionServices = { queue: QueueService; session: SessionService };

export function createServices(db: TttDatabase): SessionServices {
  return { queue: new QueueService(db), session: new SessionService(db) };
}
