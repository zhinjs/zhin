import { createHash } from 'node:crypto';
import {
  readFile as nodeReadFile,
  readdir as nodeReaddir,
} from 'node:fs/promises';
import { join } from 'node:path';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue,
} from './canonical-value.js';
import {
  HumanIngressProposalSequenceConflictError,
  MemoryHumanIngressProposalRepository,
  type HumanIngressProposalEvent,
  type HumanIngressProposalEventDraft,
  type HumanIngressProposalRepository,
} from './human-ingress.js';
import {
  DurableFileStore,
  nodeDurableFileSystem,
  type DurableFileHandle,
  type DurableFileSystem,
} from './durable-file-store.js';

export type HumanIngressFileHandle = DurableFileHandle;

/** Injectable only at the crash-durable filesystem boundary. */
export interface HumanIngressFileSystem extends DurableFileSystem {
  readdir(path: string): Promise<readonly string[]>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
}

const nodeFileSystem: HumanIngressFileSystem = Object.freeze({
  ...nodeDurableFileSystem,
  readdir: async (path: string): Promise<readonly string[]> => await nodeReaddir(path),
  readFile: async (path: string, encoding: 'utf8'): Promise<string> =>
    await nodeReadFile(path, encoding),
});

interface HumanIngressSegmentPayload {
  readonly version: 1;
  readonly projectId: string;
  readonly expectedSequence: number;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly events: readonly HumanIngressProposalEvent[];
}

interface HumanIngressSegment extends HumanIngressSegmentPayload {
  readonly payloadDigest: string;
}

/**
 * Crash-durable, content-free Human Ingress proposal history.
 *
 * The leaf directory is created non-recursively: its parent must already be a
 * durable directory. Each immutable segment is published through a hard link
 * whose project hash and first sequence form the cross-process CAS pathname.
 */
export class FileHumanIngressProposalRepository
implements HumanIngressProposalRepository {
  readonly #durable: DurableFileStore;

  constructor(
    readonly directory: string,
    readonly fileSystem: HumanIngressFileSystem = nodeFileSystem,
  ) {
    this.#durable = new DurableFileStore(directory, fileSystem);
  }

  async read(projectId: string): Promise<readonly HumanIngressProposalEvent[]> {
    const id = identifier(projectId, 'projectId');
    const events = await this.#readEvents(id);
    if (events.length > 0) await this.#durable.syncLeaf();
    return events;
  }

  async append(
    projectId: string,
    expectedSequence: number,
    drafts: readonly HumanIngressProposalEventDraft[],
  ): Promise<readonly HumanIngressProposalEvent[]> {
    const id = identifier(projectId, 'projectId');
    sequence(expectedSequence, 'expectedSequence');
    const snapshots = snapshotDrafts(drafts);
    const current = await this.#readEvents(id);
    const events = await materializeAgainst(id, current, expectedSequence, snapshots);
    const actualSequence = current.at(-1)?.sequence ?? -1;
    if (events.every(event => event.sequence <= actualSequence)) {
      if (current.length > 0) await this.#durable.syncLeaf();
      return events;
    }

    const firstSequence = events[0]!.sequence;
    const payload = deepFreeze<HumanIngressSegmentPayload>({
      version: 1,
      projectId: id,
      expectedSequence,
      firstSequence,
      lastSequence: events.at(-1)!.sequence,
      events,
    });
    const segment = deepFreeze<HumanIngressSegment>({
      ...payload,
      payloadDigest: digestCanonicalWorkroomValue(payload),
    });

    await this.#durable.ensureDurableLeaf('Human ingress proposal repository');
    const path = this.#segmentPath(id, firstSequence);
    const published = await this.#durable.publishCreateOnly({
      target: path,
      content: JSON.stringify(segment),
      createdValue: events,
      onConflict: async () => {
        const winner = await this.#readEvents(id);
        const winnerSequence = winner.at(-1)?.sequence ?? -1;
        if (expectedSequence + snapshots.length > winnerSequence) {
          throw new HumanIngressProposalSequenceConflictError(
            id,
            expectedSequence,
            winnerSequence,
          );
        }
        return await materializeAgainst(id, winner, expectedSequence, snapshots);
      },
    });
    return published.value;
  }

  async #readEvents(projectId: string): Promise<readonly HumanIngressProposalEvent[]> {
    let names: readonly string[];
    try {
      names = await this.fileSystem.readdir(this.directory);
    } catch (error) {
      if (isMissingFile(error)) return deepFreeze([]);
      throw error;
    }
    const segments = await Promise.all(names
      .filter(name => name.endsWith('.json'))
      .map(async name => parseSegment(
        await this.fileSystem.readFile(join(this.directory, name), 'utf8'),
        name,
      )));
    const selected = segments
      .filter(segment => segment.projectId === projectId)
      .sort((left, right) => left.firstSequence - right.firstSequence);
    const events: HumanIngressProposalEvent[] = [];
    let expectedSequence = -1;
    for (const segment of selected) {
      if (segment.expectedSequence !== expectedSequence
        || segment.firstSequence !== expectedSequence + 1) {
        throw new Error('Human ingress proposal segment sequence gap');
      }
      events.push(...segment.events);
      expectedSequence = segment.lastSequence;
    }
    return await validateHistory(projectId, events);
  }

  #segmentPath(projectId: string, firstSequence: number): string {
    return join(this.directory, segmentName(projectId, firstSequence));
  }

}

function snapshotDrafts(
  drafts: readonly HumanIngressProposalEventDraft[],
): readonly HumanIngressProposalEventDraft[] {
  if (!Array.isArray(drafts)) throw new Error('Human ingress proposal append requires events');
  const encoded = JSON.stringify(drafts);
  if (typeof encoded !== 'string') throw new Error('Invalid Human ingress proposal event drafts');
  return deepFreeze(JSON.parse(encoded) as HumanIngressProposalEventDraft[]);
}

async function materializeAgainst(
  projectId: string,
  current: readonly HumanIngressProposalEvent[],
  expectedSequence: number,
  drafts: readonly HumanIngressProposalEventDraft[],
): Promise<readonly HumanIngressProposalEvent[]> {
  const validator = new MemoryHumanIngressProposalRepository();
  if (current.length > 0) {
    await validator.append(projectId, -1, current.map(event => eventDraft(event)));
  }
  return await validator.append(projectId, expectedSequence, drafts);
}

async function validateHistory(
  projectId: string,
  values: readonly HumanIngressProposalEvent[],
): Promise<readonly HumanIngressProposalEvent[]> {
  if (values.length === 0) return deepFreeze([]);
  const validator = new MemoryHumanIngressProposalRepository();
  const canonical = await validator.append(projectId, -1, values.map(event => eventDraft(event)));
  if (canonicalWorkroomJson(canonical) !== canonicalWorkroomJson(values)) {
    throw new Error('Human ingress proposal event digest or payload is corrupt');
  }
  return canonical;
}

function eventDraft(event: HumanIngressProposalEvent): HumanIngressProposalEventDraft {
  return {
    eventId: event.eventId,
    type: event.type,
    proposal: event.proposal,
  };
}

function parseSegment(value: string, name: string): HumanIngressSegment {
  const match = /^([a-f0-9]{64})\.(\d{16})\.json$/u.exec(name);
  if (!match) throw new Error('Invalid Human ingress proposal segment name');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error('Invalid Human ingress proposal segment JSON', { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid Human ingress proposal segment');
  }
  assertExactKeys(parsed as Record<string, unknown>, [
    'version', 'projectId', 'expectedSequence', 'firstSequence',
    'lastSequence', 'events', 'payloadDigest',
  ], 'segment');
  const segment = parsed as Partial<HumanIngressSegment>;
  if (segment.version !== 1
    || typeof segment.projectId !== 'string'
    || !Number.isSafeInteger(segment.expectedSequence)
    || !Number.isSafeInteger(segment.firstSequence)
    || !Number.isSafeInteger(segment.lastSequence)
    || !Array.isArray(segment.events)
    || typeof segment.payloadDigest !== 'string') {
    throw new Error('Invalid Human ingress proposal segment');
  }
  const projectId = identifier(segment.projectId, 'projectId');
  const expectedSequence = sequence(segment.expectedSequence, 'expectedSequence');
  const firstSequence = sequence(segment.firstSequence, 'firstSequence', false);
  const lastSequence = sequence(segment.lastSequence, 'lastSequence', false);
  if (match[1] !== projectIdHash(projectId) || Number(match[2]) !== firstSequence) {
    throw new Error('Human ingress proposal segment name binding mismatch');
  }
  const events = deepFreeze(structuredClone(segment.events) as HumanIngressProposalEvent[]);
  if (events.length === 0
    || firstSequence !== expectedSequence + 1
    || events[0]?.sequence !== firstSequence
    || events.at(-1)?.sequence !== lastSequence) {
    throw new Error('Invalid Human ingress proposal segment position');
  }
  for (let index = 0; index < events.length; index += 1) {
    if (events[index]?.sequence !== firstSequence + index) {
      throw new Error('Invalid Human ingress proposal event position');
    }
  }
  const payload = deepFreeze<HumanIngressSegmentPayload>({
    version: 1,
    projectId,
    expectedSequence,
    firstSequence,
    lastSequence,
    events,
  });
  if (segment.payloadDigest !== digestCanonicalWorkroomValue(payload)) {
    throw new Error('Human ingress proposal segment payload digest mismatch');
  }
  return deepFreeze({ ...payload, payloadDigest: segment.payloadDigest });
}

function segmentName(projectId: string, firstSequence: number): string {
  return `${projectIdHash(projectId)}.${String(firstSequence).padStart(16, '0')}.json`;
}

function projectIdHash(projectId: string): string {
  return createHash('sha256').update(projectId).digest('hex');
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Human ingress proposal ${field} must be canonical text`);
  }
  return value;
}

function sequence(value: unknown, field: string, allowNegativeOne = true): number {
  const minimum = allowNegativeOne ? -1 : 0;
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`Human ingress proposal ${field} must be a valid sequence`);
  }
  return value as number;
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  const expected = new Set(keys);
  const unexpected = Object.keys(value).find(key => !expected.has(key));
  const missing = keys.find(key => !Object.hasOwn(value, key));
  if (unexpected || missing) {
    throw new Error(`Invalid Human ingress proposal ${field} schema`);
  }
}

function isMissingFile(error: unknown): boolean {
  return isNodeError(error) && error.code === 'ENOENT';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
