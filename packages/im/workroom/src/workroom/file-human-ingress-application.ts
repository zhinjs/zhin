import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue,
} from './canonical-value.js';
import {
  HumanIngressApplicationSequenceConflictError,
  MemoryHumanIngressApplicationRepository,
  type HumanIngressApplicationEvent,
  type HumanIngressApplicationEventDraft,
  type HumanIngressApplicationRepository,
} from './human-ingress-application.js';
import { DurableFileStore } from './durable-file-store.js';

interface ApplicationSegmentPayload {
  readonly version: 1;
  readonly projectId: string;
  readonly expectedSequence: number;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly events: readonly HumanIngressApplicationEvent[];
}

interface ApplicationSegment extends ApplicationSegmentPayload {
  readonly payloadDigest: string;
}

/** Crash-durable lifecycle journal for the Orchestrator Inbox consumer. */
export class FileHumanIngressApplicationRepository
implements HumanIngressApplicationRepository {
  readonly #durable: DurableFileStore;

  constructor(readonly directory: string) {
    this.#durable = new DurableFileStore(directory);
  }

  async read(projectId: string): Promise<readonly HumanIngressApplicationEvent[]> {
    const id = text(projectId, 'projectId');
    const events = await this.#readEvents(id);
    if (events.length > 0) await this.#durable.syncLeaf();
    return events;
  }

  async append(
    projectId: string,
    expectedSequence: number,
    drafts: readonly HumanIngressApplicationEventDraft[],
  ): Promise<readonly HumanIngressApplicationEvent[]> {
    const id = text(projectId, 'projectId');
    const snapshots = deepFreeze(structuredClone(drafts) as HumanIngressApplicationEventDraft[]);
    const current = await this.#readEvents(id);
    const events = await materialize(id, current, expectedSequence, snapshots);
    const actualSequence = current.at(-1)?.sequence ?? -1;
    if (events.every(event => event.sequence <= actualSequence)) {
      if (current.length > 0) await this.#durable.syncLeaf();
      return events;
    }
    const firstSequence = events[0]!.sequence;
    const payload = deepFreeze<ApplicationSegmentPayload>({
      version: 1,
      projectId: id,
      expectedSequence,
      firstSequence,
      lastSequence: events.at(-1)!.sequence,
      events,
    });
    const segment = deepFreeze<ApplicationSegment>({
      ...payload,
      payloadDigest: digestCanonicalWorkroomValue(payload),
    });
    await this.#durable.ensureDurableLeaf('Human ingress application repository');
    const published = await this.#durable.publishCreateOnly({
      target: join(this.directory, segmentName(id, firstSequence)),
      content: JSON.stringify(segment),
      createdValue: events,
      onConflict: async () => {
        const winner = await this.#readEvents(id);
        const actual = winner.at(-1)?.sequence ?? -1;
        if (expectedSequence + snapshots.length > actual) {
          throw new HumanIngressApplicationSequenceConflictError(id, expectedSequence, actual);
        }
        return await materialize(id, winner, expectedSequence, snapshots);
      },
    });
    return published.value;
  }

  async #readEvents(projectId: string): Promise<readonly HumanIngressApplicationEvent[]> {
    let names: readonly string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return deepFreeze([]);
      throw error;
    }
    const segments = (await Promise.all(names
      .filter(name => name.endsWith('.json'))
      .map(async name => parseSegment(name, await readFile(join(this.directory, name), 'utf8')))))
      .filter(segment => segment.projectId === projectId)
      .sort((left, right) => left.firstSequence - right.firstSequence);
    const events: HumanIngressApplicationEvent[] = [];
    let expectedSequence = -1;
    for (const segment of segments) {
      if (segment.expectedSequence !== expectedSequence
        || segment.firstSequence !== expectedSequence + 1) {
        throw new Error('Human ingress application segment sequence gap');
      }
      events.push(...segment.events);
      expectedSequence = segment.lastSequence;
    }
    return await validateHistory(projectId, events);
  }
}

async function materialize(
  projectId: string,
  current: readonly HumanIngressApplicationEvent[],
  expectedSequence: number,
  drafts: readonly HumanIngressApplicationEventDraft[],
): Promise<readonly HumanIngressApplicationEvent[]> {
  const repository = new MemoryHumanIngressApplicationRepository();
  if (current.length > 0) await repository.append(projectId, -1, current.map(toDraft));
  return await repository.append(projectId, expectedSequence, drafts);
}

async function validateHistory(
  projectId: string,
  events: readonly HumanIngressApplicationEvent[],
): Promise<readonly HumanIngressApplicationEvent[]> {
  if (events.length === 0) return deepFreeze([]);
  const repository = new MemoryHumanIngressApplicationRepository();
  const canonical = await repository.append(projectId, -1, events.map(toDraft));
  if (canonicalWorkroomJson(canonical) !== canonicalWorkroomJson(events)) {
    throw new Error('Human ingress application event digest or payload is corrupt');
  }
  return canonical;
}

function toDraft(event: HumanIngressApplicationEvent): HumanIngressApplicationEventDraft {
  const { version: _version, projectId: _projectId, sequence: _sequence, digest: _digest, ...draft } = event;
  return draft;
}

function parseSegment(name: string, encoded: string): ApplicationSegment {
  const match = /^([a-f0-9]{64})\.(\d{16})\.json$/u.exec(name);
  if (!match) throw new Error('Invalid Human ingress application segment name');
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch (error) {
    throw new Error('Invalid Human ingress application segment JSON', { cause: error });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Human ingress application segment');
  }
  const segment = value as Partial<ApplicationSegment>;
  if (segment.version !== 1
    || typeof segment.projectId !== 'string'
    || !Number.isSafeInteger(segment.expectedSequence)
    || !Number.isSafeInteger(segment.firstSequence)
    || !Number.isSafeInteger(segment.lastSequence)
    || !Array.isArray(segment.events)
    || typeof segment.payloadDigest !== 'string') {
    throw new Error('Invalid Human ingress application segment');
  }
  const projectId = text(segment.projectId, 'projectId');
  const expectedSequence = segment.expectedSequence!;
  const firstSequence = segment.firstSequence!;
  const lastSequence = segment.lastSequence!;
  if (match[1] !== projectHash(projectId) || Number(match[2]) !== firstSequence) {
    throw new Error('Human ingress application segment name binding mismatch');
  }
  const events = deepFreeze(structuredClone(segment.events) as HumanIngressApplicationEvent[]);
  if (events.length === 0
    || firstSequence !== expectedSequence + 1
    || events[0]?.sequence !== firstSequence
    || events.at(-1)?.sequence !== lastSequence) {
    throw new Error('Invalid Human ingress application segment position');
  }
  const payload = deepFreeze<ApplicationSegmentPayload>({
    version: 1,
    projectId,
    expectedSequence,
    firstSequence,
    lastSequence,
    events,
  });
  if (segment.payloadDigest !== digestCanonicalWorkroomValue(payload)) {
    throw new Error('Human ingress application segment payload digest mismatch');
  }
  return deepFreeze({ ...payload, payloadDigest: segment.payloadDigest });
}

function segmentName(projectId: string, firstSequence: number): string {
  return `${projectHash(projectId)}.${String(firstSequence).padStart(16, '0')}.json`;
}

function projectHash(projectId: string): string {
  return createHash('sha256').update(projectId).digest('hex');
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Human ingress application ${field} must be canonical text`);
  }
  return value;
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code);
}
