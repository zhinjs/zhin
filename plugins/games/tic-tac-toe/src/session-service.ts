import type { Database, DatabaseFeature, Message, Models, RelatedModel } from 'zhin.js';
import { channelKey, boardMessageMatches } from '@zhin.js/game-shared';
import type { TttModelName, TttSessionRow } from './models.js';

/** 井字棋服务使用的数据库实例（Models 经 models.ts 模块增强） */
export type TttDatabase = Database<unknown, Models, string>;

type TttModel<K extends TttModelName> = RelatedModel<unknown, Models, K>;

export type TttPlayerRef = { id: string; displayName: string };

function getModel<K extends TttModelName>(db: TttDatabase, name: K): TttModel<K> {
  const model = db.models.get(name);
  if (!model) {
    throw new Error(`Model ${name} is not registered`);
  }
  return model as TttModel<K>;
}

export class QueueService {
  constructor(private readonly db: TttDatabase) {}

  async join(
    channel: string,
    userId: string,
    displayName?: string,
  ): Promise<{ queued: boolean; position: number }> {
    const q = getModel(this.db, 'ttt_queue');
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
    await q.deleteWhere({ channel_key: channel });
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
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export class SessionService {
  constructor(private readonly db: TttDatabase) {}

  async getActiveByChannel(channel: string): Promise<TttSessionRow | null> {
    const rows = await getModel(this.db, 'ttt_sessions').findAll({
      channel_key: channel,
      status: 'active',
    });
    return rows[0] ?? null;
  }

  async getById(id: string): Promise<TttSessionRow | null> {
    return getModel(this.db, 'ttt_sessions').findOne({ id });
  }

  async getActiveForUser(channel: string, userId: string): Promise<TttSessionRow | null> {
    const row = await this.getActiveByChannel(channel);
    if (!row) return null;
    if (row.player_x === userId || row.player_o === userId) return row;
    return null;
  }

  /** 根据棋盘消息 ID 查找进行中的局（QQ 等 action 带 sourceMessageId） */
  async getActiveByBoardMessageId(messageId: string): Promise<TttSessionRow | null> {
    if (!messageId) return null;
    const rows = await getModel(this.db, 'ttt_sessions').findAll({});
    for (const row of rows) {
      if (boardMessageMatches(row.board_message_id ?? '', messageId)) return row;
    }
    return null;
  }

  async createSession(input: {
    message: Message<any>;
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
      board_message_id: '',
      move_count: 0,
      updated_at: now,
      created_at: now,
    };
    await getModel(this.db, 'ttt_sessions').create(row);
    return row;
  }

  async updateSession(id: string, patch: Partial<TttSessionRow>): Promise<void> {
    await getModel(this.db, 'ttt_sessions').updateWhere(
      { id },
      { ...patch, updated_at: Date.now() },
    );
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

  async abortStale(idleMs: number): Promise<number> {
    const cutoff = Date.now() - idleMs;
    const sessions = getModel(this.db, 'ttt_sessions');
    const rows = await sessions.findAll({ status: 'active' });
    let n = 0;
    for (const row of rows) {
      if (row.updated_at < cutoff) {
        await sessions.updateWhere({ id: row.id }, { status: 'aborted', updated_at: Date.now() });
        n++;
      }
    }
    return n;
  }
}

export type SessionServices = { queue: QueueService; session: SessionService };

export function createServices(db: TttDatabase): SessionServices {
  return { queue: new QueueService(db), session: new SessionService(db) };
}

export function resolveGameDatabase(feature: DatabaseFeature): TttDatabase {
  return feature.db;
}
