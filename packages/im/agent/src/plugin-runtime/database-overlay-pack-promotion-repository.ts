import { createHash } from 'node:crypto';
import { canonicalWorkroomJson } from '../workroom/canonical-value.js';
import {
  canonicalOverlayPackPromotionRecord,
  preparedOverlayPackPromotionRecord,
  type OverlayPackPromotionPreparedRecord,
  type OverlayPackPromotionPublishedRecord,
  type OverlayPackPromotionRecord,
  type OverlayPackPromotionRepository,
} from './workroom-overlay-pack-promotion.js';

export interface OverlayPackPromotionDatabaseModel {
  select(...fields: string[]): { where(query: Record<string, unknown>): Promise<Record<string, unknown>[]> };
}

export interface OverlayPackPromotionDatabaseTransaction {
  select(table: string): { where(query: Record<string, unknown>): Promise<Record<string, unknown>[]> };
  insertMany(table: string, rows: Record<string, unknown>[]): Promise<unknown>;
}

export interface OverlayPackPromotionDatabase {
  transaction<T>(
    operation: (transaction: OverlayPackPromotionDatabaseTransaction) => Promise<T>,
    options: { isolationLevel: 'SERIALIZABLE' },
  ): Promise<T>;
}

export class ActivatableOverlayPackPromotionRepository implements OverlayPackPromotionRepository {
  #delegate?: OverlayPackPromotionRepository;

  async activate(
    delegate: OverlayPackPromotionRepository,
    promotionIds: readonly string[],
    source?: OverlayPackPromotionRepository,
  ): Promise<void> {
    if (this.#delegate) throw new Error('Overlay Pack Promotion storage is already active');
    const ids = canonicalIds(promotionIds);
    for (const promotionId of ids) {
      const sourceRecord = source ? await source.read(promotionId) : undefined;
      let targetRecord = await delegate.read(promotionId);
      if (!sourceRecord) continue;
      if (sourceRecord && targetRecord && !isPromotionPrefix(sourceRecord, targetRecord)
        && !(sourceRecord.status === 'published' && targetRecord.status === 'prepared'
          && sourceRecord.commandDigest === targetRecord.commandDigest)) {
        throw new Error('Overlay Pack Promotion File/Database handoff diverged');
      }
      if (sourceRecord && !targetRecord) {
        targetRecord = await delegate.prepare(sourceRecord.status === 'published'
          ? preparedOverlayPackPromotionRecord(sourceRecord)
          : sourceRecord);
      }
      if (sourceRecord?.status === 'published' && targetRecord?.status === 'prepared') {
        targetRecord = await delegate.markPublished(sourceRecord);
      }
      targetRecord = await delegate.read(promotionId);
      if (!targetRecord || !isPromotionPrefix(sourceRecord, targetRecord)) {
        throw new Error('Overlay Pack Promotion target did not durably replay the File source');
      }
    }
    if (this.#delegate) throw new Error('Overlay Pack Promotion storage is already active');
    this.#delegate = delegate;
  }

  read(promotionId: string): Promise<OverlayPackPromotionRecord | undefined> {
    return this.#require().read(promotionId);
  }

  prepare(record: OverlayPackPromotionPreparedRecord): Promise<OverlayPackPromotionRecord> {
    return this.#require().prepare(record);
  }

  markPublished(record: OverlayPackPromotionPublishedRecord): Promise<OverlayPackPromotionPublishedRecord> {
    return this.#require().markPublished(record);
  }

  list(projectId: string): Promise<readonly OverlayPackPromotionRecord[]> {
    return this.#require().list(projectId);
  }

  #require(): OverlayPackPromotionRepository {
    if (!this.#delegate) throw new Error('Overlay Pack Promotion storage is not active');
    return this.#delegate;
  }
}

export class DatabaseOverlayPackPromotionRepository implements OverlayPackPromotionRepository {
  constructor(
    readonly database: OverlayPackPromotionDatabase,
    readonly model: OverlayPackPromotionDatabaseModel,
  ) {}

  async read(promotionId: string): Promise<OverlayPackPromotionRecord | undefined> {
    const records = parseRows(await this.model.select().where({ promotion_id: required(promotionId, 'promotionId') }));
    return records.at(-1);
  }

  async prepare(record: OverlayPackPromotionPreparedRecord): Promise<OverlayPackPromotionRecord> {
    const canonical = canonicalOverlayPackPromotionRecord(record) as OverlayPackPromotionPreparedRecord;
    return await this.#insert(canonical, 0);
  }

  async markPublished(record: OverlayPackPromotionPublishedRecord): Promise<OverlayPackPromotionPublishedRecord> {
    const canonical = canonicalOverlayPackPromotionRecord(record) as OverlayPackPromotionPublishedRecord;
    return await this.#insert(canonical, 1) as OverlayPackPromotionPublishedRecord;
  }

  async list(projectId: string): Promise<readonly OverlayPackPromotionRecord[]> {
    const rows = await this.model.select().where({ project_id: required(projectId, 'projectId') });
    const byPromotion = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const promotionId = required(row.promotion_id, 'promotionId');
      byPromotion.set(promotionId, [...(byPromotion.get(promotionId) ?? []), row]);
    }
    return Object.freeze([...byPromotion.values()].map(group => parseRows(group).at(-1)!)
      .sort((left, right) => left.promotionId.localeCompare(right.promotionId)));
  }

  async #insert(record: OverlayPackPromotionRecord, stage: 0 | 1): Promise<OverlayPackPromotionRecord> {
    try {
      return await this.database.transaction(async transaction => {
        const current = parseRows(await transaction.select('workroom_overlay_pack_promotions')
          .where({ promotion_id: record.promotionId }));
        const latest = current.at(-1);
        if (latest?.status === 'published') {
          if (latest.digest !== record.digest && latest.commandDigest !== record.commandDigest) {
            throw new Error('Overlay Pack promotion publication drift');
          }
          return latest;
        }
        if (latest && stage === 0) {
          if (latest.digest !== record.digest) throw new Error('Overlay Pack promotion identity drift');
          return latest;
        }
        if (stage === 1) {
          if (!latest || latest.status !== 'prepared'
            || latest.commandDigest !== record.commandDigest) {
            throw new Error('Overlay Pack promotion prepared record is unavailable or stale');
          }
        }
        await transaction.insertMany('workroom_overlay_pack_promotions', [toRow(record, stage)]);
        return record;
      }, { isolationLevel: 'SERIALIZABLE' });
    } catch (error) {
      if (isDomainError(error)) throw error;
      const winner = await this.read(record.promotionId);
      if (winner?.digest === record.digest) return winner;
      if (winner && stage === 0 && winner.commandDigest === record.commandDigest) return winner;
      throw error;
    }
  }
}

export const WORKROOM_OVERLAY_PACK_PROMOTIONS_MODEL = {
  id: { type: 'text' as const, primary: true, nullable: false },
  promotion_id: { type: 'text' as const, nullable: false },
  project_id: { type: 'text' as const, nullable: false },
  stage: { type: 'integer' as const, nullable: false },
  command_digest: { type: 'text' as const, nullable: false },
  record_digest: { type: 'text' as const, nullable: false },
  record_json: { type: 'text' as const, nullable: false },
};

export function defineOverlayPackPromotionDatabaseModel(
  database: Readonly<{ define(name: string, definition: unknown): void }>,
): void {
  database.define('workroom_overlay_pack_promotions', WORKROOM_OVERLAY_PACK_PROMOTIONS_MODEL);
}

function parseRows(rows: readonly Record<string, unknown>[]): readonly OverlayPackPromotionRecord[] {
  const sorted = [...rows].sort((left, right) => integer(left.stage, 'stage') - integer(right.stage, 'stage'));
  if (sorted.length > 2) throw new Error('Overlay Pack Promotion database stage overflow');
  const records = sorted.map((row, stage) => {
    exactRow(row);
    if (integer(row.stage, 'stage') !== stage || typeof row.record_json !== 'string') {
      throw new Error('Overlay Pack Promotion database row binding drift');
    }
    const record = canonicalOverlayPackPromotionRecord(JSON.parse(row.record_json) as OverlayPackPromotionRecord);
    if (row.promotion_id !== record.promotionId || row.project_id !== record.projectId
      || row.command_digest !== record.commandDigest || row.record_digest !== record.digest
      || canonicalWorkroomJson(record) !== row.record_json
      || (stage === 0) !== (record.status === 'prepared')) {
      throw new Error('Overlay Pack Promotion database record drift');
    }
    return record;
  });
  if (records.length === 2) {
    const [prepared, published] = records;
    if (prepared?.status !== 'prepared' || published?.status !== 'published'
      || prepared.commandDigest !== published.commandDigest) {
      throw new Error('Overlay Pack Promotion database two-stage chain drift');
    }
  }
  return Object.freeze(records);
}

function toRow(record: OverlayPackPromotionRecord, stage: 0 | 1): Record<string, unknown> {
  return {
    id: `${createHash('sha256').update(record.promotionId).digest('hex')}:${stage}`,
    promotion_id: record.promotionId,
    project_id: record.projectId,
    stage,
    command_digest: record.commandDigest,
    record_digest: record.digest,
    record_json: canonicalWorkroomJson(record),
  };
}

function exactRow(row: Record<string, unknown>): void {
  const keys = ['id', 'promotion_id', 'project_id', 'stage', 'command_digest', 'record_digest', 'record_json'];
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) {
    throw new Error('Overlay Pack Promotion database row exact schema drift');
  }
}

function canonicalIds(values: readonly string[]): readonly string[] {
  const ids = values.map(value => required(value, 'promotionId')).sort();
  if (new Set(ids).size !== ids.length) throw new Error('Overlay Pack Promotion activation contains duplicate ids');
  return ids;
}

function isPromotionPrefix(
  source: OverlayPackPromotionRecord,
  target: OverlayPackPromotionRecord,
): boolean {
  return canonicalWorkroomJson(source) === canonicalWorkroomJson(target)
    || (source.status === 'prepared' && target.status === 'published'
      && source.commandDigest === target.commandDigest);
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} is invalid`);
  return Number(value);
}

function isDomainError(error: unknown): boolean {
  return error instanceof Error && /Overlay Pack promotion/u.test(error.message);
}
