import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from '../workroom/canonical-value.js';
import {
  DurableFileStore,
  nodeDurableFileSystem,
  type DurableFileSystem,
} from '../workroom/durable-file-store.js';
import {
  replayPayloadLifecycle,
  type PayloadLifecycleEvent,
  type PayloadLifecycleEventDraft,
  type PayloadLifecycleJournal,
} from './payload-lifecycle.js';

export class PayloadLifecycleSequenceConflictError extends Error {
  constructor(
    readonly projectId: string,
    readonly objectId: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`Payload Lifecycle sequence conflict for ${projectId}/${objectId}`);
    this.name = 'PayloadLifecycleSequenceConflictError';
  }
}

interface PayloadLifecycleSegmentBody {
  readonly version: 1;
  readonly projectId: string;
  readonly objectId: string;
  readonly expectedSequence: number;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly events: readonly PayloadLifecycleEvent[];
}

interface PayloadLifecycleSegment extends PayloadLifecycleSegmentBody {
  readonly digest: string;
}

/** Crash-durable, content-free immutable lifecycle fact repository. */
export class FilePayloadLifecycleRepository implements PayloadLifecycleJournal {
  readonly #store: DurableFileStore;
  #ready?: Promise<void>;

  constructor(
    readonly directory: string,
    fileSystem: DurableFileSystem = nodeDurableFileSystem,
  ) {
    this.#store = new DurableFileStore(directory, fileSystem);
  }

  async read(projectId: string, objectId: string): Promise<readonly PayloadLifecycleEvent[]> {
    requiredText(projectId, 'Lifecycle Project id');
    requiredText(objectId, 'Lifecycle object id');
    const prefix = objectPrefix(projectId, objectId);
    let names: readonly string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return Object.freeze([]);
      throw error;
    }
    const matched = names.filter(name => name.startsWith(prefix) && name.endsWith('.json')).sort();
    const events: PayloadLifecycleEvent[] = [];
    let expectedFirst = 0;
    for (const name of matched) {
      if (!new RegExp(`^${escapeRegExp(prefix)}[0-9]{16}\\.json$`, 'u').test(name)) {
        throw new Error('Payload Lifecycle segment filename is invalid');
      }
      const segment = parseSegment(await readFile(join(this.directory, name), 'utf8'), projectId, objectId);
      if (segment.firstSequence !== expectedFirst || segment.expectedSequence !== expectedFirst - 1) {
        throw new Error('Payload Lifecycle Journal contains a sequence gap');
      }
      events.push(...segment.events);
      expectedFirst = segment.lastSequence + 1;
    }
    const canonical = deepFreeze(events);
    replayPayloadLifecycle(projectId, objectId, canonical);
    if (canonical.length > 0) await this.#store.syncLeaf();
    return canonical;
  }

  async append(
    projectId: string,
    objectId: string,
    expectedSequence: number,
    drafts: readonly PayloadLifecycleEventDraft[],
  ): Promise<readonly PayloadLifecycleEvent[]> {
    requiredText(projectId, 'Lifecycle Project id');
    requiredText(objectId, 'Lifecycle object id');
    if (!Number.isSafeInteger(expectedSequence) || expectedSequence < -1) {
      throw new Error('Payload Lifecycle expected sequence is invalid');
    }
    if (!Array.isArray(drafts) || drafts.length === 0) return Object.freeze([]);
    const snapshot = deepFreeze(structuredClone(drafts));
    const current = await this.read(projectId, objectId);
    const replay = exactReplay(current, expectedSequence, snapshot);
    if (replay) return replay;
    const actual = current.at(-1)?.sequence ?? -1;
    if (actual !== expectedSequence) {
      throw new PayloadLifecycleSequenceConflictError(projectId, objectId, expectedSequence, actual);
    }
    const events = deepFreeze(snapshot.map((draft, offset) => {
      const body = deepFreeze({
        ...structuredClone(draft),
        version: 1 as const,
        projectId,
        objectId,
        sequence: expectedSequence + offset + 1,
      });
      return deepFreeze<PayloadLifecycleEvent>({ ...body, digest: digest(body) }) as PayloadLifecycleEvent;
    }));
    replayPayloadLifecycle(projectId, objectId, deepFreeze([...current, ...events]));
    const segmentBody = deepFreeze<PayloadLifecycleSegmentBody>({
      version: 1,
      projectId,
      objectId,
      expectedSequence,
      firstSequence: events[0]!.sequence,
      lastSequence: events.at(-1)!.sequence,
      events,
    });
    const segment = deepFreeze<PayloadLifecycleSegment>({ ...segmentBody, digest: digest(segmentBody) });
    await this.#ensureReady();
    const target = join(this.directory,
      `${objectPrefix(projectId, objectId)}${String(segment.firstSequence).padStart(16, '0')}.json`);
    const publication = await this.#store.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(segment),
      createdValue: events,
      onConflict: async () => {
        const winner = await this.read(projectId, objectId);
        const exact = exactReplay(winner, expectedSequence, snapshot);
        if (!exact) {
          throw new PayloadLifecycleSequenceConflictError(
            projectId, objectId, expectedSequence, winner.at(-1)?.sequence ?? -1,
          );
        }
        return exact;
      },
    });
    await this.#store.syncLeafAndParent();
    return publication.value;
  }

  async listObjectIds(projectId: string): Promise<readonly string[]> {
    requiredText(projectId, 'Lifecycle Project id');
    const prefix = `${keyHash(projectId)}.`;
    let names: readonly string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return Object.freeze([]);
      throw error;
    }
    const objectIds = new Set<string>();
    for (const name of names.filter(value => value.startsWith(prefix) && value.endsWith('.json')).sort()) {
      const raw = JSON.parse(await readFile(join(this.directory, name), 'utf8')) as { objectId?: unknown };
      if (typeof raw.objectId !== 'string') throw new Error('Payload Lifecycle segment object identity is malformed');
      objectIds.add(raw.objectId);
    }
    return Object.freeze([...objectIds].sort());
  }

  #ensureReady(): Promise<void> {
    this.#ready ??= this.#store.ensureDurableLeaf('Payload Lifecycle Journal');
    return this.#ready;
  }
}

function parseSegment(raw: string, projectId: string, objectId: string): PayloadLifecycleSegment {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error('Payload Lifecycle segment is malformed', { cause: error });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Payload Lifecycle segment is malformed');
  }
  const segment = value as PayloadLifecycleSegment;
  const { digest: supplied, ...body } = segment;
  if (segment.version !== 1 || segment.projectId !== projectId || segment.objectId !== objectId
    || supplied !== digest(body) || !Array.isArray(segment.events) || segment.events.length === 0
    || segment.firstSequence !== segment.events[0]?.sequence
    || segment.lastSequence !== segment.events.at(-1)?.sequence) {
    throw new Error('Payload Lifecycle segment identity/digest is invalid');
  }
  return deepFreeze(structuredClone(segment));
}

function exactReplay(
  events: readonly PayloadLifecycleEvent[],
  expectedSequence: number,
  drafts: readonly PayloadLifecycleEventDraft[],
): readonly PayloadLifecycleEvent[] | undefined {
  const first = expectedSequence + 1;
  if (events.length < first + drafts.length) return undefined;
  const candidate = events.slice(first, first + drafts.length);
  return canonicalWorkroomJson(candidate.map(({ version: _version, projectId: _projectId,
    objectId: _objectId, sequence: _sequence, digest: _digest, ...draft }) => draft))
    === canonicalWorkroomJson(drafts)
    ? deepFreeze(candidate)
    : undefined;
}

function objectPrefix(projectId: string, objectId: string): string {
  return `${keyHash(projectId)}.${keyHash(objectId)}.`;
}

function keyHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requiredText(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code);
}
