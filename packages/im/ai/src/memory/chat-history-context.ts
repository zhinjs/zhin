/**
 * 只读：从 chat_messages + ai_summaries 构建 LLM 历史（AI 包不写 chat_messages）。
 */

import { Logger } from '@zhin.js/logger';
import type { ChatMessage } from '../types.js';
import type { MessageRecord } from './context-manager.js';

const logger = new Logger(null, 'ChatHistory');

export interface ChatHistoryConfig {
  coldStartMaxMessages?: number;
  coldStartMaxAgeMs?: number;
}

export interface ChatHistoryQuery {
  sessionId: string;
  platform: string;
  botId: string;
  sceneId: string;
}

interface SummaryRow {
  id?: number;
  session_id: string;
  summary: string;
  anchor_message_id?: string;
  created_at: number;
}

type WhereResult =
  | PromiseLike<MessageRecord[]>
  | {
      orderBy(field: string, dir: 'ASC' | 'DESC'): {
        limit(n: number): PromiseLike<MessageRecord[]>;
      };
    };

interface DbModel {
  select(...fields: string[]): {
    where(condition: Record<string, unknown>): WhereResult;
  };
}

interface SummaryDbModel {
  select(...fields: string[]): {
    where(condition: Record<string, unknown>): {
      orderBy(field: string, dir: 'ASC' | 'DESC'): {
        limit(n: number): PromiseLike<SummaryRow[]>;
      };
    };
  };
}

function isQueryChain(result: WhereResult): result is {
  orderBy(field: string, dir: 'ASC' | 'DESC'): {
    limit(n: number): PromiseLike<MessageRecord[]>;
  };
} {
  return (
    result != null &&
    typeof result === 'object' &&
    'orderBy' in result &&
    typeof (result as { orderBy?: unknown }).orderBy === 'function'
  );
}

function recordToChatMessage(row: MessageRecord): ChatMessage {
  const role =
    row.direction === 'outbound' || row.sender_role === 'assistant' || row.sender_role === 'bot'
      ? 'assistant'
      : 'user';
  return { role, content: row.message };
}

function applyAfterAnchorFilter(
  rows: MessageRecord[],
  afterTime?: number,
  afterId?: number,
): MessageRecord[] {
  if (afterTime == null) return rows;
  return rows.filter(
    (r) =>
      r.time > afterTime ||
      (r.time === afterTime && (r.id ?? 0) > (afterId ?? 0)),
  );
}

function sortAndTail(rows: MessageRecord[], limit?: number): MessageRecord[] {
  rows.sort((a, b) => a.time - b.time || (a.id ?? 0) - (b.id ?? 0));
  if (limit != null && rows.length > limit) {
    return rows.slice(-limit);
  }
  return rows;
}

export class ChatHistoryContext {
  private readonly messageModel: DbModel;
  private readonly summaryModel: SummaryDbModel;
  private readonly config: Required<Pick<ChatHistoryConfig, 'coldStartMaxMessages' | 'coldStartMaxAgeMs'>>;

  constructor(
    messageModel: DbModel,
    summaryModel: SummaryDbModel,
    config: ChatHistoryConfig = {},
  ) {
    this.messageModel = messageModel;
    this.summaryModel = summaryModel;
    this.config = {
      coldStartMaxMessages: config.coldStartMaxMessages ?? 50,
      coldStartMaxAgeMs: config.coldStartMaxAgeMs ?? 24 * 60 * 60 * 1000,
    };
  }

  async hasStoredMessages(query: ChatHistoryQuery): Promise<boolean> {
    const rows = await this.querySceneMessages(query, {
      sinceTime: Date.now() - this.config.coldStartMaxAgeMs,
      limit: 1,
    });
    return rows.length > 0;
  }

  async buildHistoryMessages(query: ChatHistoryQuery): Promise<ChatMessage[]> {
    const summary = await this.getLatestSummary(query.sessionId);
    const out: ChatMessage[] = [];

    if (summary?.summary) {
      out.push({ role: 'system', content: `[Conversation summary]\n${summary.summary}` });
    }

    let rows: MessageRecord[];
    if (summary?.anchor_message_id) {
      const anchor = await this.findAnchorRow(query, summary.anchor_message_id);
      if (anchor) {
        rows = await this.querySceneMessages(query, {
          afterTime: anchor.time,
          afterId: anchor.id,
        });
      } else {
        logger.warn(
          `[ChatHistory] anchor ${summary.anchor_message_id} not found, cold start`,
        );
        rows = await this.coldStartRows(query);
      }
    } else {
      rows = await this.coldStartRows(query);
    }

    for (const row of rows) {
      out.push(recordToChatMessage(row));
    }
    return out;
  }

  private async getLatestSummary(sessionId: string): Promise<SummaryRow | null> {
    try {
      const rows = (await this.summaryModel
        .select()
        .where({ session_id: sessionId })
        .orderBy('created_at', 'DESC')
        .limit(1)) as SummaryRow[];
      return rows[0] ?? null;
    } catch (err) {
      logger.debug('getLatestSummary failed:', err);
      return null;
    }
  }

  private async findAnchorRow(
    query: ChatHistoryQuery,
    anchorMessageId: string,
  ): Promise<MessageRecord | null> {
    try {
      const rows = await this.messageModel.select().where({
        platform: query.platform,
        bot_id: query.botId,
        scene_id: query.sceneId,
        message_id: anchorMessageId,
      });
      const list = await Promise.resolve(rows as MessageRecord[] | PromiseLike<MessageRecord[]>);
      return list[0] ?? null;
    } catch {
      return null;
    }
  }

  private async coldStartRows(query: ChatHistoryQuery): Promise<MessageRecord[]> {
    const since = Date.now() - this.config.coldStartMaxAgeMs;
    const rows = await this.querySceneMessages(query, {
      sinceTime: since,
      limit: this.config.coldStartMaxMessages,
    });
    return rows;
  }

  private sceneKeysWhere(query: ChatHistoryQuery): Record<string, unknown> {
    return {
      platform: query.platform,
      bot_id: query.botId,
      scene_id: query.sceneId,
    };
  }

  private sceneWhereWithTime(
    query: ChatHistoryQuery,
    opts: { sinceTime?: number; afterTime?: number },
  ): Record<string, unknown> {
    const where = this.sceneKeysWhere(query);
    if (opts.sinceTime != null) {
      where.time = { $gte: opts.sinceTime };
    } else if (opts.afterTime != null) {
      where.time = { $gt: opts.afterTime };
    }
    return where;
  }

  private async querySceneMessages(
    query: ChatHistoryQuery,
    opts: { sinceTime?: number; afterTime?: number; afterId?: number; limit?: number },
  ): Promise<MessageRecord[]> {
    const limit = opts.limit ?? this.config.coldStartMaxMessages;
    try {
      const probe = this.messageModel.select().where(this.sceneKeysWhere(query));

      if (isQueryChain(probe)) {
        const fetchN = Math.min(Math.max(limit * 4, limit), 500);
        const timed = this.messageModel.select().where(this.sceneWhereWithTime(query, opts));
        if (!isQueryChain(timed)) {
          return [];
        }
        let rows = (await timed.orderBy('time', 'DESC').limit(fetchN)) as MessageRecord[];
        rows = rows.reverse();
        rows = applyAfterAnchorFilter(rows, opts.afterTime, opts.afterId);
        return sortAndTail(rows, limit);
      }

      let rows = (await Promise.resolve(
        probe as PromiseLike<MessageRecord[]>,
      )) as MessageRecord[];
      if (opts.sinceTime != null) {
        rows = rows.filter((r) => r.time >= opts.sinceTime!);
      }
      if (opts.afterTime != null) {
        rows = applyAfterAnchorFilter(rows, opts.afterTime, opts.afterId);
      }
      return sortAndTail(rows, limit);
    } catch (err) {
      logger.debug('querySceneMessages failed:', err);
      return [];
    }
  }
}
