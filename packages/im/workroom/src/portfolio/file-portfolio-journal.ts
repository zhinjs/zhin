import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  InMemoryPortfolioJournalRepository,
  parsePortfolioFactDraft,
  type PortfolioFact,
  type PortfolioFactDraft,
  type PortfolioJournalRepository,
} from './portfolio-journal.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import { DurableFileStore } from '../workroom/durable-file-store.js';

interface PortfolioSegmentPayload {
  readonly version: 1;
  readonly portfolioId: string;
  readonly expectedSequence: number;
  readonly events: readonly PortfolioFact[];
}

interface PortfolioSegment extends PortfolioSegmentPayload {
  readonly payloadDigest: string;
}

/** Crash-durable immutable-segment adapter for the Portfolio Journal contract. */
export class FilePortfolioJournalRepository implements PortfolioJournalRepository {
  readonly #store: DurableFileStore;

  constructor(readonly directory: string) {
    this.#store = new DurableFileStore(directory);
  }

  async listPortfolioIds(): Promise<readonly string[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return Object.freeze([]);
      throw error;
    }
    if (names.some(name => name.endsWith('.json') && !isSegmentName(name))) {
      throw new Error('Invalid Portfolio Journal segment name');
    }
    const ids = new Set<string>();
    for (const name of names.filter(isSegmentName).sort()) {
      ids.add((await parseSegment(
        await readFile(join(this.directory, name), 'utf8'),
        name,
      )).portfolioId);
    }
    if (ids.size > 0) await this.#store.syncLeaf();
    return Object.freeze([...ids].sort());
  }

  async read(portfolioId: string): Promise<readonly PortfolioFact[]> {
    const id = identifier(portfolioId, 'portfolioId');
    const prefix = `${hashId(id)}.`;
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return Object.freeze([]);
      throw error;
    }
    const candidates = names.filter(name => name.startsWith(prefix) && name.endsWith('.json'));
    if (candidates.some(name => !isSegmentName(name))) {
      throw new Error('Invalid Portfolio Journal segment name');
    }
    const segments = await Promise.all(candidates.sort().map(async name =>
      await parseSegment(await readFile(join(this.directory, name), 'utf8'), name)));
    if (segments.some(segment => segment.portfolioId !== id)) {
      throw new Error('Portfolio Journal identifier digest collision');
    }
    const validator = new InMemoryPortfolioJournalRepository();
    const events: PortfolioFact[] = [];
    for (const segment of segments) {
      if (segment.expectedSequence !== events.length - 1) {
        throw new Error('Portfolio Journal segment sequence is not contiguous');
      }
      const appended = await validator.append(
        id,
        segment.expectedSequence,
        segment.events.map(toDraft),
      );
      if (canonicalWorkroomJson(appended) !== canonicalWorkroomJson(segment.events)) {
        throw new Error('Portfolio Journal segment replay drift');
      }
      events.push(...appended);
    }
    if (events.length > 0) await this.#store.syncLeaf();
    return deepFreeze(events);
  }

  async append(
    portfolioId: string,
    expectedSequence: number,
    drafts: readonly PortfolioFactDraft[],
  ): Promise<readonly PortfolioFact[]> {
    const id = identifier(portfolioId, 'portfolioId');
    const current = await this.read(id);
    const validator = await seed(id, current);
    const appended = await validator.append(id, expectedSequence, drafts);
    if (appended.length === 0 || appended.every(event => event.sequence <= (current.at(-1)?.sequence ?? -1))) {
      return appended;
    }
    const payload = deepFreeze<PortfolioSegmentPayload>({
      version: 1,
      portfolioId: id,
      expectedSequence,
      events: appended,
    });
    const segment = deepFreeze<PortfolioSegment>({ ...payload, payloadDigest: digest(payload) });
    await this.#store.ensureDurableLeaf('Portfolio Journal');
    const target = join(this.directory, segmentName(id, appended[0]!.sequence));
    const published = await this.#store.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(segment),
      createdValue: appended,
      onConflict: async () => {
        const winner = await this.read(id);
        return await (await seed(id, winner)).append(id, expectedSequence, drafts);
      },
    });
    return published.value;
  }
}

async function seed(
  portfolioId: string,
  events: readonly PortfolioFact[],
): Promise<InMemoryPortfolioJournalRepository> {
  const repository = new InMemoryPortfolioJournalRepository();
  for (const event of events) {
    await repository.append(portfolioId, event.sequence - 1, [toDraft(event)]);
  }
  return repository;
}

function toDraft(event: PortfolioFact): PortfolioFactDraft {
  return deepFreeze({
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    type: event.type,
    payload: event.payload,
  });
}

async function parseSegment(serialized: string, name: string): Promise<PortfolioSegment> {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new Error('Portfolio Journal segment is not valid JSON', { cause: error });
  }
  if (!isRecord(value) || value.version !== 1 || typeof value.portfolioId !== 'string'
    || !Number.isSafeInteger(value.expectedSequence) || Number(value.expectedSequence) < -1
    || !Array.isArray(value.events) || value.events.length === 0
    || typeof value.payloadDigest !== 'string') {
    throw new Error('Invalid Portfolio Journal segment');
  }
  const segment = value as unknown as PortfolioSegment;
  const expectedSequence = Number(value.expectedSequence);
  const events = normalizeSegmentEvents(value.events, value.portfolioId, expectedSequence);
  const payload: PortfolioSegmentPayload = {
    version: 1,
    portfolioId: identifier(segment.portfolioId, 'portfolioId'),
    expectedSequence,
    events,
  };
  if (segment.payloadDigest !== digest(payload)) {
    throw new Error('Portfolio Journal segment payload digest mismatch');
  }
  if (name !== segmentName(payload.portfolioId, payload.expectedSequence + 1)) {
    throw new Error('Portfolio Journal segment first sequence does not match its filename');
  }
  return deepFreeze({ ...payload, payloadDigest: segment.payloadDigest });
}

function normalizeSegmentEvents(
  values: readonly unknown[],
  portfolioId: string,
  expectedSequence: number,
): readonly PortfolioFact[] {
  return deepFreeze(values.map((value, index): PortfolioFact => {
    if (!isRecord(value) || value.version !== 1 || value.portfolioId !== portfolioId
      || value.sequence !== expectedSequence + index + 1
      || typeof value.eventId !== 'string' || !value.eventId.trim()
      || typeof value.occurredAt !== 'number' || !Number.isFinite(value.occurredAt)
      || typeof value.type !== 'string' || !isRecord(value.payload)) {
      throw new Error('Invalid Portfolio Journal segment event');
    }
    const draft = parsePortfolioFactDraft({
      eventId: value.eventId,
      occurredAt: value.occurredAt,
      type: value.type as PortfolioFact['type'],
      payload: value.payload,
    });
    const normalized = deepFreeze({
      version: 1,
      portfolioId,
      sequence: value.sequence,
      ...draft,
    } as PortfolioFact);
    if (canonicalWorkroomJson(normalized) !== canonicalWorkroomJson(value)) {
      throw new Error('Portfolio Journal segment event materialization drift');
    }
    return normalized;
  }));
}

function segmentName(portfolioId: string, firstSequence: number): string {
  return `${hashId(portfolioId)}.${String(firstSequence).padStart(16, '0')}.json`;
}

function hashId(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isSegmentName(name: string): boolean {
  return /^[a-f0-9]{64}\.[0-9]{16}\.json$/u.test(name);
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Invalid Portfolio ${label}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code);
}
