/**
 * im_transcripts — IM audit / chat_history keyword search (ADR 0009 D4).
 */

import { getLogger } from '@zhin.js/logger';
import type {
  ImTranscriptRecord,
  ImTranscriptWriteInput,
} from './agent-db-models.js';

const logger = getLogger('ImTranscriptStore');

export interface ImTranscriptQuery {
  platform: string;
  endpointId: string;
  sceneId: string;
}

export interface ImTranscriptSearchHit {
  time: number;
  body: string;
  senderName?: string;
  direction: ImTranscriptRecord['direction'];
}

export interface ImTranscriptSearchResult {
  messages: ImTranscriptSearchHit[];
}

export interface ImTranscriptStoreConfig {
  searchMaxAgeMs?: number;
  searchLimit?: number;
}

/** DB / 内存实现的统一契约 */
export interface ImTranscriptStore {
  record(input: ImTranscriptWriteInput): Promise<void>;
  search(query: ImTranscriptQuery, keyword: string, limit?: number): Promise<ImTranscriptSearchResult>;
  listRecent(query: ImTranscriptQuery, limit?: number): Promise<ImTranscriptSearchResult>;
}

type WhereResult =
  | PromiseLike<ImTranscriptRecord[]>
  | {
      orderBy(field: string, dir: 'ASC' | 'DESC'): {
        limit(n: number): PromiseLike<ImTranscriptRecord[]>;
      };
    };

interface DbModel {
  select(...fields: string[]): {
    where(condition: Record<string, unknown>): WhereResult;
  };
  create(data: Record<string, unknown>): Promise<unknown>;
}

function isQueryChain(result: WhereResult): result is {
  orderBy(field: string, dir: 'ASC' | 'DESC'): {
    limit(n: number): PromiseLike<ImTranscriptRecord[]>;
  };
} {
  return (
    result != null &&
    typeof result === 'object' &&
    'orderBy' in result &&
    typeof (result as { orderBy?: unknown }).orderBy === 'function'
  );
}

function sceneWhere(query: ImTranscriptQuery): Record<string, unknown> {
  return {
    platform: query.platform,
    endpoint_id: query.endpointId,
    scene_id: query.sceneId,
  };
}

export class DatabaseImTranscriptStore implements ImTranscriptStore {
  private readonly model: DbModel;
  private readonly config: Required<Pick<ImTranscriptStoreConfig, 'searchMaxAgeMs' | 'searchLimit'>>;

  constructor(model: DbModel, config: ImTranscriptStoreConfig = {}) {
    this.model = model;
    this.config = {
      searchMaxAgeMs: config.searchMaxAgeMs ?? 24 * 60 * 60 * 1000,
      searchLimit: config.searchLimit ?? 20,
    };
  }

  async record(input: ImTranscriptWriteInput): Promise<void> {
    const body = input.body ?? '';
    const media = input.media_json ?? '';
    if (!body.trim() && !media.trim()) return;

    await this.model.create({
      message_id: input.message_id ?? '',
      platform: input.platform,
      endpoint_id: input.endpoint_id,
      scene_id: input.scene_id,
      scene_type: input.scene_type,
      sender_id: input.sender_id,
      sender_name: input.sender_name ?? '',
      sender_role: input.sender_role ?? 'user',
      direction: input.direction,
      body,
      media_json: media,
      time: input.time ?? Date.now(),
    });
  }

  /** Keyword search on body only (Grill #1 / #17). */
  async search(query: ImTranscriptQuery, keyword: string, limit?: number): Promise<ImTranscriptSearchResult> {
    const kw = keyword.trim();
    const cap = Math.min(Math.max(limit ?? this.config.searchLimit, 1), 100);
    const since = Date.now() - this.config.searchMaxAgeMs;

    if (!kw) {
      return this.listRecent(query, cap);
    }

    let rows: ImTranscriptRecord[] = [];
    try {
      const where = {
        ...sceneWhere(query),
        time: { $gte: since },
      };
      const probe = this.model.select().where(sceneWhere(query));
      if (isQueryChain(probe)) {
        const timed = this.model.select().where(where);
        if (isQueryChain(timed)) {
          rows = (await timed.orderBy('time', 'DESC').limit(cap * 3)) as ImTranscriptRecord[];
        }
      } else {
        const all = (await Promise.resolve(probe as PromiseLike<ImTranscriptRecord[]>)) ?? [];
        const lower = kw.toLowerCase();
        rows = all.filter(
          (r) => r.time >= since && r.body.toLowerCase().includes(lower),
        );
      }

      const lower = kw.toLowerCase();
      rows = rows
        .filter((r) => r.body.toLowerCase().includes(lower))
        .sort((a, b) => a.time - b.time)
        .slice(-cap);
    } catch (err) {
      logger.debug('search failed:', err);
    }

    return {
      messages: rows.map((r) => ({
        time: r.time,
        body: r.body,
        senderName: r.sender_name || undefined,
        direction: r.direction,
      })),
    };
  }

  async listRecent(query: ImTranscriptQuery, limit?: number): Promise<ImTranscriptSearchResult> {
    const cap = Math.min(Math.max(limit ?? this.config.searchLimit, 1), 100);
    const since = Date.now() - this.config.searchMaxAgeMs;
    let rows: ImTranscriptRecord[] = [];

    try {
      const where = { ...sceneWhere(query), time: { $gte: since } };
      const timed = this.model.select().where(where);
      if (isQueryChain(timed)) {
        rows = (await timed.orderBy('time', 'DESC').limit(cap)) as ImTranscriptRecord[];
        rows = rows.reverse();
      }
    } catch (err) {
      logger.debug('listRecent failed:', err);
    }

    return {
      messages: rows.map((r) => ({
        time: r.time,
        body: r.body,
        senderName: r.sender_name || undefined,
        direction: r.direction,
      })),
    };
  }
}

export class MemoryImTranscriptStore implements ImTranscriptStore {
  private rows: ImTranscriptRecord[] = [];
  private seq = 0;
  private readonly searchMaxAgeMs: number;
  private readonly searchLimit: number;

  constructor(config: ImTranscriptStoreConfig = {}) {
    this.searchMaxAgeMs = config.searchMaxAgeMs ?? 24 * 60 * 60 * 1000;
    this.searchLimit = config.searchLimit ?? 20;
  }

  async record(input: ImTranscriptWriteInput): Promise<void> {
    const body = input.body ?? '';
    const media = input.media_json ?? '';
    if (!body.trim() && !media.trim()) return;
    this.rows.push({
      id: ++this.seq,
      message_id: input.message_id ?? '',
      platform: input.platform,
      endpoint_id: input.endpoint_id,
      scene_id: input.scene_id,
      scene_type: input.scene_type,
      sender_id: input.sender_id,
      sender_name: input.sender_name ?? '',
      sender_role: input.sender_role ?? 'user',
      direction: input.direction,
      body,
      media_json: media,
      time: input.time ?? Date.now(),
    });
  }

  getAll(): ImTranscriptRecord[] {
    return [...this.rows];
  }

  async search(query: ImTranscriptQuery, keyword: string, limit?: number): Promise<ImTranscriptSearchResult> {
    const kw = keyword.trim();
    const cap = Math.min(Math.max(limit ?? this.searchLimit, 1), 100);
    const since = Date.now() - this.searchMaxAgeMs;
    const sceneRows = this.rows.filter(
      (r) =>
        r.platform === query.platform
        && r.endpoint_id === query.endpointId
        && r.scene_id === query.sceneId
        && r.time >= since,
    );

    if (!kw) {
      return {
        messages: sceneRows
          .sort((a, b) => a.time - b.time)
          .slice(-cap)
          .map((r) => ({
            time: r.time,
            body: r.body,
            senderName: r.sender_name || undefined,
            direction: r.direction,
          })),
      };
    }

    const lower = kw.toLowerCase();
    return {
      messages: sceneRows
        .filter((r) => r.body.toLowerCase().includes(lower))
        .sort((a, b) => a.time - b.time)
        .slice(-cap)
        .map((r) => ({
          time: r.time,
          body: r.body,
          senderName: r.sender_name || undefined,
          direction: r.direction,
        })),
    };
  }

  async listRecent(query: ImTranscriptQuery, limit?: number): Promise<ImTranscriptSearchResult> {
    return this.search(query, '', limit);
  }
}
