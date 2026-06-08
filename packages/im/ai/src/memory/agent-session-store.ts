/**
 * agent_sessions CRUD — epoch-aware session metadata (ADR 0009 D4).
 */

import { Logger } from '@zhin.js/logger';
import type {
  AgentSessionRecord,
  CreateAgentSessionInput,
} from './agent-db-models.js';

const logger = new Logger(null, 'AgentSessionStore');

export interface AgentSessionStoreConfig {
  sessionIdleArchiveMs?: number;
}

interface DbModel {
  select(...fields: string[]): {
    where(condition: Record<string, unknown>): Promise<AgentSessionRecord[]>;
  };
  create(data: Record<string, unknown>): Promise<unknown>;
  update(data: Record<string, unknown>): {
    where(condition: Record<string, unknown>): Promise<unknown>;
  };
}

let sessionEpochSeq = 0;

export function createAgentSessionEpochId(sessionKey: string): string {
  sessionEpochSeq += 1;
  return `${sessionKey}#${Date.now()}-${sessionEpochSeq}`;
}

export class AgentSessionStore {
  private readonly model: DbModel;
  private readonly config: Required<Pick<AgentSessionStoreConfig, 'sessionIdleArchiveMs'>>;

  constructor(model: DbModel, config: AgentSessionStoreConfig = {}) {
    this.model = model;
    this.config = {
      sessionIdleArchiveMs: config.sessionIdleArchiveMs ?? 7 * 24 * 60 * 60 * 1000,
    };
  }

  async findActive(sessionKey: string): Promise<AgentSessionRecord | null> {
    try {
      const rows = await this.model
        .select()
        .where({ session_key: sessionKey, status: 'active' });
      if (!rows?.length) return null;
      return rows.sort((a, b) => b.updated_at - a.updated_at)[0] ?? null;
    } catch (err) {
      logger.debug('findActive failed:', err);
      return null;
    }
  }

  async getOrCreateActive(input: CreateAgentSessionInput): Promise<AgentSessionRecord> {
    const existing = await this.findActive(input.session_key);
    if (existing) {
      await this.touch(existing.session_id);
      return existing;
    }
    await this.archiveIdleForKey(input.session_key);
    const now = Date.now();
    const record: AgentSessionRecord = {
      session_id: createAgentSessionEpochId(input.session_key),
      session_key: input.session_key,
      platform: input.platform,
      bot_id: input.bot_id,
      scene_id: input.scene_id,
      scene_type: input.scene_type,
      model: input.model ?? '',
      status: 'active',
      created_at: now,
      updated_at: now,
    };
    await this.model.create(record as unknown as Record<string, unknown>);
    return record;
  }

  async touch(sessionId: string): Promise<void> {
    try {
      await this.model.update({ updated_at: Date.now() }).where({ session_id: sessionId });
    } catch (err) {
      logger.debug('touch failed:', err);
    }
  }

  async getBySessionId(sessionId: string): Promise<AgentSessionRecord | null> {
    try {
      const rows = await this.model.select().where({ session_id: sessionId });
      return rows?.[0] ?? null;
    } catch (err) {
      logger.debug('getBySessionId failed:', err);
      return null;
    }
  }

  async setActiveLeafMessageId(sessionId: string, messageId: number | null): Promise<void> {
    try {
      await this.model
        .update({ active_leaf_message_id: messageId, updated_at: Date.now() })
        .where({ session_id: sessionId });
    } catch (err) {
      logger.debug('setActiveLeafMessageId failed:', err);
    }
  }

  async archiveByKey(sessionKey: string): Promise<boolean> {
    try {
      const rows = await this.model
        .select()
        .where({ session_key: sessionKey, status: 'active' });
      if (!rows?.length) return false;
      const now = Date.now();
      for (const row of rows) {
        await this.model.update({ status: 'archived', updated_at: now }).where({ session_id: row.session_id });
      }
      return true;
    } catch (err) {
      logger.debug('archiveByKey failed:', err);
      return false;
    }
  }

  async archiveIdleForKey(sessionKey: string): Promise<number> {
    const idleMs = this.config.sessionIdleArchiveMs;
    if (idleMs <= 0) return 0;
    const cutoff = Date.now() - idleMs;
    try {
      const rows = await this.model
        .select()
        .where({ session_key: sessionKey, status: 'active' });
      let n = 0;
      for (const row of rows) {
        if (row.updated_at < cutoff) {
          await this.model.update({ status: 'archived', updated_at: Date.now() }).where({ session_id: row.session_id });
          n++;
        }
      }
      return n;
    } catch (err) {
      logger.debug('archiveIdleForKey failed:', err);
      return 0;
    }
  }
}

export class MemoryAgentSessionStore {
  private sessions = new Map<string, AgentSessionRecord>();

  async findActive(sessionKey: string): Promise<AgentSessionRecord | null> {
    for (const s of this.sessions.values()) {
      if (s.session_key === sessionKey && s.status === 'active') return s;
    }
    return null;
  }

  async getOrCreateActive(input: CreateAgentSessionInput): Promise<AgentSessionRecord> {
    const existing = await this.findActive(input.session_key);
    if (existing) {
      existing.updated_at = Date.now();
      return existing;
    }
    const now = Date.now();
    const record: AgentSessionRecord = {
      session_id: createAgentSessionEpochId(input.session_key),
      session_key: input.session_key,
      platform: input.platform,
      bot_id: input.bot_id,
      scene_id: input.scene_id,
      scene_type: input.scene_type,
      model: input.model ?? '',
      status: 'active',
      created_at: now,
      updated_at: now,
    };
    this.sessions.set(record.session_id, record);
    return record;
  }

  async touch(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s) s.updated_at = Date.now();
  }

  async getBySessionId(sessionId: string): Promise<AgentSessionRecord | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async setActiveLeafMessageId(sessionId: string, messageId: number | null): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.active_leaf_message_id = messageId;
      s.updated_at = Date.now();
    }
  }

  async archiveByKey(sessionKey: string): Promise<boolean> {
    let ok = false;
    for (const s of this.sessions.values()) {
      if (s.session_key === sessionKey && s.status === 'active') {
        s.status = 'archived';
        s.updated_at = Date.now();
        ok = true;
      }
    }
    return ok;
  }

  async archiveIdleForKey(_sessionKey: string): Promise<number> {
    return 0;
  }
}
