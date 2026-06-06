/**
 * ContextRepository — epoch-only LLM context load/save (ADR 0009 D4 / Grill #15).
 */

import { Logger } from '@zhin.js/logger';
import type { AgentMessage, UserMessage } from '../llm/types/agent-message.js';
import { createUserMessage } from '../llm/types/agent-message.js';
import type { Context } from '../llm/types/context.js';
import { createContext } from '../llm/types/context.js';
import type {
  AgentMessageRow,
  AgentSummaryRecord,
} from './agent-db-models.js';
import {
  parseAgentMessageRow,
  serializeAgentMessage,
} from './agent-db-models.js';
import { AgentSessionStore, MemoryAgentSessionStore } from './agent-session-store.js';
import { SessionWriteLock } from './session-write-lock.js';

const logger = new Logger(null, 'ContextRepository');

export interface ContextRepositoryConfig {
  /** Max messages loaded per session epoch (tail). */
  tailMessageLimit?: number;
}

export interface ContextRepository {
  loadContext(sessionId: string): Promise<Context>;
  appendMessages(sessionId: string, messages: AgentMessage[]): Promise<void>;
  archiveSession(sessionKey: string): Promise<boolean>;
  saveSummary(sessionId: string, summary: string, anchorMessageId?: number): Promise<void>;
}

type MessageDbModel = {
  select(...fields: string[]): {
    where(condition: Record<string, unknown>): MessageWhereResult;
  };
  create(data: Record<string, unknown>): Promise<unknown>;
};

type SummaryDbModel = {
  select(...fields: string[]): {
    where(condition: Record<string, unknown>): SummaryWhereResult;
  };
  create(data: Record<string, unknown>): Promise<unknown>;
};

type MessageWhereResult =
  | PromiseLike<AgentMessageRow[]>
  | {
      orderBy(field: string, dir: 'ASC' | 'DESC'): {
        limit(n: number): PromiseLike<AgentMessageRow[]>;
      };
    };

type SummaryWhereResult =
  | PromiseLike<AgentSummaryRecord[]>
  | {
      orderBy(field: string, dir: 'ASC' | 'DESC'): {
        limit(n: number): PromiseLike<AgentSummaryRecord[]>;
      };
    };

function isMessageQueryChain(result: MessageWhereResult): result is {
  orderBy(field: string, dir: 'ASC' | 'DESC'): {
    limit(n: number): PromiseLike<AgentMessageRow[]>;
  };
} {
  return (
    result != null &&
    typeof result === 'object' &&
    'orderBy' in result &&
    typeof (result as { orderBy?: unknown }).orderBy === 'function'
  );
}

function isSummaryQueryChain(result: SummaryWhereResult): result is {
  orderBy(field: string, dir: 'ASC' | 'DESC'): {
    limit(n: number): PromiseLike<AgentSummaryRecord[]>;
  };
} {
  return (
    result != null &&
    typeof result === 'object' &&
    'orderBy' in result &&
    typeof (result as { orderBy?: unknown }).orderBy === 'function'
  );
}

const SUMMARY_PREFIX = '[Previous conversation summary]\n';

function summaryAsUserMessage(summary: string, createdAt: number): UserMessage {
  return createUserMessage(`${SUMMARY_PREFIX}${summary}`, undefined, createdAt);
}

export class DatabaseContextRepository implements ContextRepository {
  private readonly messageModel: MessageDbModel;
  private readonly summaryModel: SummaryDbModel;
  private readonly sessionStore: AgentSessionStore;
  private readonly writeLock = new SessionWriteLock();
  private readonly config: Required<Pick<ContextRepositoryConfig, 'tailMessageLimit'>>;

  constructor(
    messageModel: MessageDbModel,
    summaryModel: SummaryDbModel,
    sessionStore: AgentSessionStore,
    config: ContextRepositoryConfig = {},
  ) {
    this.messageModel = messageModel;
    this.summaryModel = summaryModel;
    this.sessionStore = sessionStore;
    this.config = {
      tailMessageLimit: config.tailMessageLimit ?? 100,
    };
  }

  async loadContext(sessionId: string): Promise<Context> {
    const summary = await this.loadLatestSummary(sessionId);
    const rows = await this.loadMessageRows(sessionId);
    const messages: AgentMessage[] = [];

    if (summary) {
      messages.push(summaryAsUserMessage(summary.summary, summary.created_at));
    }

    for (const row of rows) {
      const parsed = parseAgentMessageRow(row);
      if (parsed) messages.push(parsed);
    }

    return createContext('', messages);
  }

  async appendMessages(sessionId: string, newMessages: AgentMessage[]): Promise<void> {
    if (newMessages.length === 0) return;
    await this.writeLock.run(sessionId, async () => {
      for (const message of newMessages) {
        const row = serializeAgentMessage(message);
        row.session_id = sessionId;
        await this.messageModel.create(row as unknown as Record<string, unknown>);
      }
      await this.sessionStore.touch(sessionId);
    });
  }

  async archiveSession(sessionKey: string): Promise<boolean> {
    return this.sessionStore.archiveByKey(sessionKey);
  }

  async saveSummary(sessionId: string, summary: string, anchorMessageId?: number): Promise<void> {
    const text = summary.trim();
    if (!text) return;
    await this.writeLock.run(sessionId, async () => {
      await this.summaryModel.create({
        session_id: sessionId,
        summary: text,
        anchor_message_id: anchorMessageId ?? null,
        created_at: Date.now(),
      });
    });
  }

  private async loadLatestSummary(sessionId: string): Promise<AgentSummaryRecord | null> {
    try {
      const probe = this.summaryModel.select().where({ session_id: sessionId });
      if (isSummaryQueryChain(probe)) {
        const rows = (await probe.orderBy('created_at', 'DESC').limit(1)) as AgentSummaryRecord[];
        return rows[0] ?? null;
      }
      const rows = (await Promise.resolve(probe as PromiseLike<AgentSummaryRecord[]>)) ?? [];
      return rows.sort((a, b) => b.created_at - a.created_at)[0] ?? null;
    } catch (err) {
      logger.debug('loadLatestSummary failed:', err);
      return null;
    }
  }

  private async loadMessageRows(sessionId: string): Promise<AgentMessageRow[]> {
    const limit = this.config.tailMessageLimit;
    try {
      const probe = this.messageModel.select().where({ session_id: sessionId });
      if (isMessageQueryChain(probe)) {
        const rows = (await probe.orderBy('timestamp', 'DESC').limit(limit)) as AgentMessageRow[];
        return rows.reverse();
      }
      const rows = (await Promise.resolve(probe as PromiseLike<AgentMessageRow[]>)) ?? [];
      rows.sort((a, b) => a.timestamp - b.timestamp || (a.id ?? 0) - (b.id ?? 0));
      if (rows.length > limit) {
        return rows.slice(-limit);
      }
      return rows;
    } catch (err) {
      logger.debug('loadMessageRows failed:', err);
      return [];
    }
  }
}

export class MemoryContextRepository implements ContextRepository {
  private readonly messages = new Map<string, AgentMessageRow[]>();
  private readonly summaries = new Map<string, AgentSummaryRecord[]>();
  private readonly sessionStore: MemoryAgentSessionStore;
  private readonly writeLock = new SessionWriteLock();
  private readonly config: Required<Pick<ContextRepositoryConfig, 'tailMessageLimit'>>;

  constructor(
    sessionStore: MemoryAgentSessionStore,
    config: ContextRepositoryConfig = {},
  ) {
    this.sessionStore = sessionStore;
    this.config = {
      tailMessageLimit: config.tailMessageLimit ?? 100,
    };
  }

  async loadContext(sessionId: string): Promise<Context> {
    const summaryList = this.summaries.get(sessionId) ?? [];
    const latest = summaryList.sort((a, b) => b.created_at - a.created_at)[0];
    const rows = [...(this.messages.get(sessionId) ?? [])];
    rows.sort((a, b) => a.timestamp - b.timestamp || (a.id ?? 0) - (b.id ?? 0));
    const tail = rows.length > this.config.tailMessageLimit
      ? rows.slice(-this.config.tailMessageLimit)
      : rows;

    const messages: AgentMessage[] = [];
    if (latest) {
      messages.push(summaryAsUserMessage(latest.summary, latest.created_at));
    }
    for (const row of tail) {
      const parsed = parseAgentMessageRow(row);
      if (parsed) messages.push(parsed);
    }
    return createContext('', messages);
  }

  async appendMessages(sessionId: string, newMessages: AgentMessage[]): Promise<void> {
    if (newMessages.length === 0) return;
    await this.writeLock.run(sessionId, async () => {
      const list = this.messages.get(sessionId) ?? [];
      let seq = list.length;
      for (const message of newMessages) {
        const row = serializeAgentMessage(message);
        row.session_id = sessionId;
        row.id = ++seq;
        list.push(row);
      }
      this.messages.set(sessionId, list);
      await this.sessionStore.touch(sessionId);
    });
  }

  async archiveSession(sessionKey: string): Promise<boolean> {
    return this.sessionStore.archiveByKey(sessionKey);
  }

  async saveSummary(sessionId: string, summary: string, anchorMessageId?: number): Promise<void> {
    const text = summary.trim();
    if (!text) return;
    await this.writeLock.run(sessionId, async () => {
      const list = this.summaries.get(sessionId) ?? [];
      list.push({
        id: list.length + 1,
        session_id: sessionId,
        summary: text,
        anchor_message_id: anchorMessageId ?? null,
        created_at: Date.now(),
      });
      this.summaries.set(sessionId, list);
    });
  }
}

export function createMemoryContextRepository(
  config?: ContextRepositoryConfig,
): { repository: MemoryContextRepository; sessionStore: MemoryAgentSessionStore } {
  const sessionStore = new MemoryAgentSessionStore();
  return {
    sessionStore,
    repository: new MemoryContextRepository(sessionStore, config),
  };
}
