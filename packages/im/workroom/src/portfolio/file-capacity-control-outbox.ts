import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DurableFileStore } from '../workroom/durable-file-store.js';
import {
  createPortfolioControlOutboxEvent,
  replayPortfolioControlOutbox,
  type PortfolioControlOutboxEvent,
  type PortfolioControlOutboxEventDraft,
  type PortfolioControlOutboxRepository,
} from './capacity-control-outbox.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';

interface Segment {
  readonly version: 1;
  readonly portfolioId: string;
  readonly expectedSequence: number;
  readonly event: PortfolioControlOutboxEvent;
  readonly digest: string;
}

export class FilePortfolioControlOutboxRepository implements PortfolioControlOutboxRepository {
  readonly #store: DurableFileStore;
  constructor(readonly directory: string) { this.#store = new DurableFileStore(directory); }

  async listPortfolioIds(): Promise<readonly string[]> {
    let names: readonly string[];
    try {
      names = (await readdir(this.directory)).filter(name => name.endsWith('.json')).sort();
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return Object.freeze([]);
      throw error;
    }
    const ids = new Set<string>();
    for (const name of names) {
      const value = JSON.parse(await readFile(join(this.directory, name), 'utf8')) as { portfolioId?: unknown };
      if (typeof value.portfolioId !== 'string' || !value.portfolioId.trim()) {
        throw new Error('Portfolio Control Outbox segment has no Portfolio identity');
      }
      ids.add(value.portfolioId);
    }
    for (const portfolioId of ids) await this.read(portfolioId);
    return Object.freeze([...ids].sort());
  }

  async read(portfolioId: string): Promise<readonly PortfolioControlOutboxEvent[]> {
    const prefix = filePrefix(portfolioId);
    let names: readonly string[];
    try {
      names = (await readdir(this.directory)).filter(name => name.startsWith(prefix)).sort();
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return Object.freeze([]);
      throw error;
    }
    const events: PortfolioControlOutboxEvent[] = [];
    for (const [sequence, name] of names.entries()) {
      if (name !== fileName(portfolioId, sequence)) throw new Error('Portfolio Control Outbox segment gap');
      events.push(parseSegment(await readFile(join(this.directory, name), 'utf8'), portfolioId, sequence).event);
    }
    replayPortfolioControlOutbox(portfolioId, events);
    if (events.length) await this.#store.syncLeaf();
    return Object.freeze(events);
  }

  async append(
    portfolioId: string,
    expectedSequence: number,
    draft: PortfolioControlOutboxEventDraft,
  ): Promise<PortfolioControlOutboxEvent> {
    const current = await this.read(portfolioId);
    if (current.length - 1 !== expectedSequence) throw new Error('Portfolio Control Outbox sequence conflict');
    const event = createPortfolioControlOutboxEvent(portfolioId, expectedSequence + 1, draft);
    replayPortfolioControlOutbox(portfolioId, [...current, event]);
    const body = deepFreeze({
      version: 1 as const, portfolioId, expectedSequence, event,
    });
    const segment = deepFreeze<Segment>({ ...body, digest: digest(body) });
    await this.#store.ensureDurableLeaf('Portfolio Control Outbox');
    const target = join(this.directory, fileName(portfolioId, event.sequence));
    const result = await this.#store.publishCreateOnly({
      target, content: canonicalWorkroomJson(segment), createdValue: segment,
      onConflict: async () => {
        const existing = parseSegment(await readFile(target, 'utf8'), portfolioId, event.sequence);
        if (canonicalWorkroomJson(existing) !== canonicalWorkroomJson(segment)) {
          throw new Error('Portfolio Control Outbox sequence conflict');
        }
        return existing;
      },
    });
    return result.value.event;
  }
}

function parseSegment(serialized: string, portfolioId: string, sequence: number): Segment {
  const value = JSON.parse(serialized) as Segment;
  if (value.version !== 1 || value.portfolioId !== portfolioId
    || value.expectedSequence !== sequence - 1 || value.event.sequence !== sequence) {
    throw new Error('Portfolio Control Outbox segment binding drift');
  }
  const canonicalEvent = createPortfolioControlOutboxEvent(portfolioId, sequence, {
    type: value.event.type,
    payload: value.event.payload,
  } as PortfolioControlOutboxEventDraft);
  if (canonicalWorkroomJson(canonicalEvent) !== canonicalWorkroomJson(value.event)) {
    throw new Error('Portfolio Control Outbox event drift');
  }
  const body = deepFreeze({ version: 1 as const, portfolioId, expectedSequence: sequence - 1, event: value.event });
  const canonical = deepFreeze({ ...body, digest: digest(body) });
  if (canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Portfolio Control Outbox segment digest drift');
  }
  return canonical;
}

function filePrefix(portfolioId: string): string {
  return `portfolio-control-${createHash('sha256').update(portfolioId).digest('hex')}-`;
}
function fileName(portfolioId: string, sequence: number): string {
  return `${filePrefix(portfolioId)}${String(sequence).padStart(16, '0')}.json`;
}
function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code);
}
