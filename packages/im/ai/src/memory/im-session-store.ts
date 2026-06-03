/**
 * IM 活跃/归档会话元数据（ai_sessions），与 chat_messages 消息正文分离。
 */

import { Logger } from '@zhin.js/logger';
import type { AISessionStatus } from './session.js';

const logger = new Logger(null, 'IM-Session');

export interface IMSessionRecord {
  id?: number;
  session_id: string;
  session_key: string;
  platform: string;
  bot_id: string;
  scene_id: string;
  scene_type: string;
  model: string;
  status: AISessionStatus;
  created_at: number;
  updated_at: number;
}

export interface CreateIMSessionInput {
  session_key: string;
  platform: string;
  bot_id: string;
  scene_id: string;
  scene_type: string;
  model?: string;
}

export interface IMSessionStoreConfig {
  sessionIdleArchiveMs?: number;
}

interface DbModel {
  select(...fields: string[]): {
    where(condition: Record<string, unknown>): Promise<IMSessionRecord[]>;
  };
  create(data: Record<string, unknown>): Promise<unknown>;
  update(data: Record<string, unknown>): {
    where(condition: Record<string, unknown>): Promise<unknown>;
  };
}

let sessionEpochSeq = 0;

export function createSessionEpochId(sessionKey: string): string {
  sessionEpochSeq += 1;
  return `${sessionKey}#${Date.now()}-${sessionEpochSeq}`;
}

export class IMSessionStore {
  private readonly model: DbModel;
  private readonly config: Required<Pick<IMSessionStoreConfig, 'sessionIdleArchiveMs'>>;

  constructor(model: DbModel, config: IMSessionStoreConfig = {}) {
    this.model = model;
    this.config = {
      sessionIdleArchiveMs: config.sessionIdleArchiveMs ?? 7 * 24 * 60 * 60 * 1000,
    };
  }

  async findActive(sessionKey: string): Promise<IMSessionRecord | null> {
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

  async getOrCreateActive(input: CreateIMSessionInput): Promise<IMSessionRecord> {
    const existing = await this.findActive(input.session_key);
    if (existing) {
      await this.touch(existing.session_id);
      return existing;
    }
    await this.archiveIdleForKey(input.session_key);
    const now = Date.now();
    const record: IMSessionRecord = {
      session_id: createSessionEpochId(input.session_key),
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

  async hasAnySession(sessionKey: string): Promise<boolean> {
    try {
      const rows = await this.model.select().where({ session_key: sessionKey });
      return (rows?.length ?? 0) > 0;
    } catch {
      return false;
    }
  }
}

export class MemoryIMSessionStore {
  private sessions = new Map<string, IMSessionRecord>();

  async findActive(sessionKey: string): Promise<IMSessionRecord | null> {
    for (const s of this.sessions.values()) {
      if (s.session_key === sessionKey && s.status === 'active') return s;
    }
    return null;
  }

  async getOrCreateActive(input: CreateIMSessionInput): Promise<IMSessionRecord> {
    const existing = await this.findActive(input.session_key);
    if (existing) {
      existing.updated_at = Date.now();
      return existing;
    }
    const now = Date.now();
    const record: IMSessionRecord = {
      session_id: createSessionEpochId(input.session_key),
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

  async hasAnySession(sessionKey: string): Promise<boolean> {
    for (const s of this.sessions.values()) {
      if (s.session_key === sessionKey) return true;
    }
    return false;
  }
}
