import { createHash } from 'node:crypto';
import {
  createPortfolioControlOutboxEvent,
  replayPortfolioControlOutbox,
  type PortfolioControlOutboxEvent,
  type PortfolioControlOutboxEventDraft,
  type PortfolioControlOutboxRepository,
} from './capacity-control-outbox.js';
import { canonicalWorkroomJson } from '../workroom/canonical-value.js';

export interface PortfolioControlOutboxDatabaseModel {
  select(...fields: string[]): {
    where(query: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
}

export interface PortfolioControlOutboxDatabaseTransaction {
  select(table: string): {
    where(query: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  };
  insertMany(table: string, rows: Record<string, unknown>[]): Promise<unknown>;
}

export interface PortfolioControlOutboxDatabase {
  transaction<T>(
    operation: (transaction: PortfolioControlOutboxDatabaseTransaction) => Promise<T>,
    options: { isolationLevel: 'SERIALIZABLE' },
  ): Promise<T>;
}

/**
 * Candidate-owned storage latch. The target is replayed before it becomes the
 * writer, so generation handoff cannot expose a partially initialized DB.
 */
export class ActivatablePortfolioControlOutboxRepository
implements PortfolioControlOutboxRepository {
  #delegate?: PortfolioControlOutboxRepository;

  async activate(
    delegate: PortfolioControlOutboxRepository,
    portfolioIds: readonly string[],
    source?: PortfolioControlOutboxRepository,
  ): Promise<void> {
    if (this.#delegate) throw new Error('Portfolio Control Outbox storage is already active');
    const ids = [...new Set(portfolioIds.map(id => required(id, 'portfolioId')))].sort();
    if (ids.length !== portfolioIds.length) {
      throw new Error('Portfolio Control Outbox activation contains duplicate Portfolio ids');
    }
    for (const portfolioId of ids) {
      const sourceEvents = source ? await source.read(portfolioId) : Object.freeze([]);
      let targetEvents = await delegate.read(portfolioId);
      replayPortfolioControlOutbox(portfolioId, sourceEvents);
      replayPortfolioControlOutbox(portfolioId, targetEvents);
      const shared = Math.min(sourceEvents.length, targetEvents.length);
      for (let index = 0; index < shared; index += 1) {
        if (canonicalWorkroomJson(sourceEvents[index]) !== canonicalWorkroomJson(targetEvents[index])) {
          throw new Error('Portfolio Control Outbox File/Database handoff diverged');
        }
      }
      for (const event of sourceEvents.slice(targetEvents.length)) {
        await delegate.append(portfolioId, event.sequence - 1, {
          type: event.type,
          payload: event.payload,
        } as PortfolioControlOutboxEventDraft);
      }
      targetEvents = await delegate.read(portfolioId);
      if (targetEvents.length < sourceEvents.length
        || sourceEvents.some((event, index) => canonicalWorkroomJson(event) !== canonicalWorkroomJson(targetEvents[index]))) {
        throw new Error('Portfolio Control Outbox target did not durably replay the File source');
      }
    }
    if (this.#delegate) throw new Error('Portfolio Control Outbox storage is already active');
    this.#delegate = delegate;
  }

  read(portfolioId: string): Promise<readonly PortfolioControlOutboxEvent[]> {
    return this.#require().read(portfolioId);
  }

  append(
    portfolioId: string,
    expectedSequence: number,
    draft: PortfolioControlOutboxEventDraft,
  ): Promise<PortfolioControlOutboxEvent> {
    return this.#require().append(portfolioId, expectedSequence, draft);
  }

  #require(): PortfolioControlOutboxRepository {
    if (!this.#delegate) throw new Error('Portfolio Control Outbox storage is not active');
    return this.#delegate;
  }
}

/** Database-backed Portfolio control outbox using the repository's SERIALIZABLE CAS convention. */
export class DatabasePortfolioControlOutboxRepository implements PortfolioControlOutboxRepository {
  constructor(
    readonly database: PortfolioControlOutboxDatabase,
    readonly model: PortfolioControlOutboxDatabaseModel,
  ) {}

  async read(portfolioId: string): Promise<readonly PortfolioControlOutboxEvent[]> {
    const id = required(portfolioId, 'portfolioId');
    return parseRows(id, await this.model.select().where({ portfolio_id: id }));
  }

  async append(
    portfolioId: string,
    expectedSequence: number,
    draft: PortfolioControlOutboxEventDraft,
  ): Promise<PortfolioControlOutboxEvent> {
    const id = required(portfolioId, 'portfolioId');
    const candidate = createPortfolioControlOutboxEvent(id, expectedSequence + 1, draft);
    try {
      return await this.database.transaction(async transaction => {
        const current = parseRows(id, await transaction.select('portfolio_control_outbox')
          .where({ portfolio_id: id }));
        const actualSequence = current.at(-1)?.sequence ?? -1;
        if (actualSequence !== expectedSequence) {
          throw sequenceConflict(id, expectedSequence, actualSequence);
        }
        replayPortfolioControlOutbox(id, [...current, candidate]);
        await transaction.insertMany('portfolio_control_outbox', [toRow(candidate)]);
        return candidate;
      }, { isolationLevel: 'SERIALIZABLE' });
    } catch (error) {
      if (isSequenceConflict(error)) throw error;
      const winner = await this.read(id);
      const actualSequence = winner.at(-1)?.sequence ?? -1;
      const occupied = winner[expectedSequence + 1];
      if (occupied && canonicalWorkroomJson(occupied) === canonicalWorkroomJson(candidate)) {
        return occupied;
      }
      if (actualSequence !== expectedSequence) {
        throw sequenceConflict(id, expectedSequence, actualSequence);
      }
      throw error;
    }
  }
}

export const PORTFOLIO_CONTROL_OUTBOX_MODEL = {
  id: { type: 'text' as const, primary: true, nullable: false },
  portfolio_id: { type: 'text' as const, nullable: false },
  sequence: { type: 'integer' as const, nullable: false },
  event_digest: { type: 'text' as const, nullable: false },
  event_json: { type: 'text' as const, nullable: false },
};

export function definePortfolioControlOutboxDatabaseModel(
  database: Readonly<{ define(name: string, definition: unknown): void }>,
): void {
  database.define('portfolio_control_outbox', PORTFOLIO_CONTROL_OUTBOX_MODEL);
}

function parseRows(
  portfolioId: string,
  rows: readonly Record<string, unknown>[],
): readonly PortfolioControlOutboxEvent[] {
  const sorted = [...rows].sort((left, right) => integer(left.sequence, 'sequence') - integer(right.sequence, 'sequence'));
  const events = sorted.map((row, sequence) => {
    exactRow(row);
    if (row.portfolio_id !== portfolioId || integer(row.sequence, 'sequence') !== sequence
      || typeof row.event_json !== 'string') {
      throw new Error('Portfolio Control Outbox database row binding drift');
    }
    const persisted = JSON.parse(row.event_json) as PortfolioControlOutboxEvent;
    const canonical = createPortfolioControlOutboxEvent(portfolioId, sequence, {
      type: persisted.type,
      payload: persisted.payload,
    } as PortfolioControlOutboxEventDraft);
    if (row.event_digest !== canonical.digest
      || canonicalWorkroomJson(persisted) !== canonicalWorkroomJson(canonical)) {
      throw new Error('Portfolio Control Outbox database event drift');
    }
    return canonical;
  });
  replayPortfolioControlOutbox(portfolioId, events);
  return Object.freeze(events);
}

function exactRow(row: Record<string, unknown>): void {
  const requiredKeys = ['id', 'portfolio_id', 'sequence', 'event_digest', 'event_json'];
  if (Object.keys(row).length !== requiredKeys.length
    || requiredKeys.some(key => !Object.hasOwn(row, key))) {
    throw new Error('Portfolio Control Outbox database row exact schema drift');
  }
}

function toRow(event: PortfolioControlOutboxEvent): Record<string, unknown> {
  return {
    id: `${createHash('sha256').update(event.portfolioId).digest('hex')}:${event.sequence}`,
    portfolio_id: event.portfolioId,
    sequence: event.sequence,
    event_digest: event.digest,
    event_json: canonicalWorkroomJson(event),
  };
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} is invalid`);
  return Number(value);
}

function sequenceConflict(portfolioId: string, expected: number, actual: number): Error {
  return Object.assign(
    new Error(`Portfolio Control Outbox sequence conflict for ${portfolioId}: expected ${expected}, actual ${actual}`),
    { code: 'PORTFOLIO_CONTROL_SEQUENCE_CONFLICT' },
  );
}

function isSequenceConflict(error: unknown): boolean {
  return !!error && typeof error === 'object'
    && 'code' in error && error.code === 'PORTFOLIO_CONTROL_SEQUENCE_CONFLICT';
}
