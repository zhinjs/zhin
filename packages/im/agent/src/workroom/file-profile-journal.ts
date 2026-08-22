import { createHash, randomUUID } from 'node:crypto';
import {
  link as nodeLink,
  mkdir as nodeMkdir,
  open as nodeOpen,
  readFile as nodeReadFile,
  readdir as nodeReaddir,
  unlink as nodeUnlink,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue,
} from './canonical-value.js';
import {
  ProfileRegistrySequenceConflictError,
  replayProjectProfileJournal,
  type ProjectProfileEvent,
  type ProjectProfileEventDraft,
  type ProjectProfileJournal,
} from './profile-registry.js';

export interface ProjectProfileJournalFileHandle {
  writeFile(value: string, encoding: 'utf8'): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** Injectable only at the durable filesystem boundary. */
export interface ProjectProfileJournalFileSystem {
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<readonly string[]>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  open(path: string, flags: 'wx' | 'r'): Promise<ProjectProfileJournalFileHandle>;
  link(existingPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

const nodeFileSystem: ProjectProfileJournalFileSystem = Object.freeze({
  mkdir: async (path: string): Promise<void> => {
    await nodeMkdir(path);
  },
  readdir: async (path: string): Promise<readonly string[]> => await nodeReaddir(path),
  readFile: async (path: string, encoding: 'utf8'): Promise<string> =>
    await nodeReadFile(path, encoding),
  open: async (
    path: string,
    flags: 'wx' | 'r',
  ): Promise<ProjectProfileJournalFileHandle> => await nodeOpen(path, flags),
  link: async (existingPath: string, newPath: string): Promise<void> =>
    await nodeLink(existingPath, newPath),
  unlink: async (path: string): Promise<void> => await nodeUnlink(path),
});

interface ProjectProfileJournalSegmentPayload {
  readonly version: 1;
  readonly projectId: string;
  readonly expectedRegistryRevision: number;
  readonly firstSequence: number;
  readonly lastSequence: number;
  readonly events: readonly ProjectProfileEvent[];
}

interface ProjectProfileJournalSegment extends ProjectProfileJournalSegmentPayload {
  readonly payloadDigest: string;
}

/**
 * Crash-durable Project Profile Registry Journal.
 *
 * The configured leaf is created non-recursively. Its parent must already be
 * durable; the adapter fsyncs that parent before publishing the first segment.
 * Every append is an immutable segment, and a hard link to the first-sequence
 * pathname is the cross-process expected-revision CAS.
 */
export class FileProjectProfileJournal implements ProjectProfileJournal {
  constructor(
    readonly directory: string,
    readonly fileSystem: ProjectProfileJournalFileSystem = nodeFileSystem,
  ) {}

  async read(projectId: string): Promise<readonly ProjectProfileEvent[]> {
    const events = await this.#readEvents(identifier(projectId, 'projectId'));
    // A previous writer may have linked the segment and then observed a failed
    // directory fsync. Re-sync before a retry is allowed to confirm that fact.
    if (events.length > 0) await this.#syncDirectoryPath(this.directory);
    return events;
  }

  async append(
    projectId: string,
    expectedRevision: number,
    drafts: readonly ProjectProfileEventDraft[],
  ): Promise<readonly ProjectProfileEvent[]> {
    const id = identifier(projectId, 'projectId');
    expectedRegistryRevision(expectedRevision);
    const snapshottedDrafts = snapshotDrafts(drafts);
    const current = await this.#readEvents(id);
    const replayed = exactReplay(current, expectedRevision, snapshottedDrafts);
    if (replayed) {
      if (current.length > 0) await this.#syncDirectoryPath(this.directory);
      return replayed;
    }
    const actualRevision = current.at(-1)?.sequence ?? -1;
    if (actualRevision !== expectedRevision) {
      throw new ProfileRegistrySequenceConflictError(id, expectedRevision, actualRevision);
    }
    if (snapshottedDrafts.length === 0) return Object.freeze([]);

    const events = deepFreeze(snapshottedDrafts.map((draft, index) => ({
      ...draft,
      version: 1 as const,
      projectId: id,
      sequence: expectedRevision + index + 1,
    } as ProjectProfileEvent)));
    replayProjectProfileJournal(id, Object.freeze([...current, ...events]));
    const payload = deepFreeze<ProjectProfileJournalSegmentPayload>({
      version: 1,
      projectId: id,
      expectedRegistryRevision: expectedRevision,
      firstSequence: events[0]!.sequence,
      lastSequence: events.at(-1)!.sequence,
      events,
    });
    const segment = deepFreeze<ProjectProfileJournalSegment>({
      ...payload,
      payloadDigest: digestCanonicalWorkroomValue(payload),
    });

    await this.#ensureDurableLeaf();
    const path = this.#segmentPath(id, segment.firstSequence);
    const temporaryPath = path + '.' + randomUUID() + '.tmp';
    let temporaryExists = false;
    try {
      const handle = await this.fileSystem.open(temporaryPath, 'wx');
      temporaryExists = true;
      try {
        await handle.writeFile(JSON.stringify(segment), 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.fileSystem.link(temporaryPath, path);
      await this.fileSystem.unlink(temporaryPath);
      temporaryExists = false;
      await this.#syncDirectoryPath(this.directory);
    } catch (error) {
      if (temporaryExists) {
        await this.#removeTemporary(temporaryPath);
        temporaryExists = false;
      }
      if (isAlreadyExists(error)) {
        const winner = await this.#readEvents(id);
        const exact = exactReplay(winner, expectedRevision, snapshottedDrafts);
        await this.#syncDirectoryPath(this.directory);
        if (exact) return exact;
        throw new ProfileRegistrySequenceConflictError(
          id,
          expectedRevision,
          winner.at(-1)?.sequence ?? -1,
        );
      }
      throw error;
    } finally {
      if (temporaryExists) await this.#removeTemporary(temporaryPath);
    }
    return events;
  }

  async #readEvents(projectId: string): Promise<readonly ProjectProfileEvent[]> {
    const prefix = projectFilePrefix(projectId);
    let names: readonly string[];
    try {
      names = await this.fileSystem.readdir(this.directory);
    } catch (error) {
      if (isMissingFile(error)) return Object.freeze([]);
      throw error;
    }
    const segmentNames = names
      .filter(name => name.startsWith(prefix) && name.endsWith('.json'))
      .sort();
    for (const name of segmentNames) {
      if (!segmentNamePattern(prefix).test(name)) {
        throw new Error('Invalid Project Profile Journal segment name');
      }
    }
    const segments = await Promise.all(segmentNames.map(async name =>
      parseSegment(
        await this.fileSystem.readFile(join(this.directory, name), 'utf8'),
        projectId,
        Number(name.slice(prefix.length, prefix.length + 16)),
      )));
    const events: ProjectProfileEvent[] = [];
    let expectedFirstSequence = 0;
    for (const segment of segments) {
      if (segment.firstSequence !== expectedFirstSequence
        || segment.expectedRegistryRevision !== expectedFirstSequence - 1) {
        throw new Error('Project Profile Journal segment sequence gap');
      }
      events.push(...segment.events);
      expectedFirstSequence = segment.lastSequence + 1;
    }
    const frozen = deepFreeze(events);
    replayProjectProfileJournal(projectId, frozen);
    return frozen;
  }

  #segmentPath(projectId: string, firstSequence: number): string {
    return join(
      this.directory,
      projectFilePrefix(projectId) + String(firstSequence).padStart(16, '0') + '.json',
    );
  }

  async #ensureDurableLeaf(): Promise<void> {
    try {
      await this.fileSystem.mkdir(this.directory);
    } catch (error) {
      if (!isAlreadyExists(error)) {
        if (isMissingFile(error)) {
          throw new Error(
            'Project Profile Journal requires a pre-existing durable parent directory: '
            + dirname(this.directory),
            { cause: error },
          );
        }
        throw error;
      }
    }
    await this.#syncDirectoryPath(dirname(this.directory));
  }

  async #syncDirectoryPath(path: string): Promise<void> {
    const handle = await this.fileSystem.open(path, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async #removeTemporary(path: string): Promise<void> {
    await this.fileSystem.unlink(path).catch(error => {
      if (!isMissingFile(error)) throw error;
    });
  }
}

function snapshotDrafts(
  drafts: readonly ProjectProfileEventDraft[],
): readonly ProjectProfileEventDraft[] {
  if (!Array.isArray(drafts)) throw new Error('Invalid Project Profile Journal event drafts');
  return deepFreeze(drafts.map(draft => {
    const encoded = JSON.stringify(draft);
    if (typeof encoded !== 'string') throw new Error('Invalid Project Profile Journal event draft');
    return JSON.parse(encoded) as ProjectProfileEventDraft;
  }));
}

function exactReplay(
  current: readonly ProjectProfileEvent[],
  expectedRevision: number,
  drafts: readonly ProjectProfileEventDraft[],
): readonly ProjectProfileEvent[] | undefined {
  if (drafts.length === 0) return current.at(-1)?.sequence === expectedRevision
    ? Object.freeze([])
    : undefined;
  const firstSequence = expectedRevision + 1;
  if (firstSequence < 0 || firstSequence + drafts.length > current.length) return undefined;
  const persisted = current.slice(firstSequence, firstSequence + drafts.length);
  const persistedDrafts = persisted.map(({ version: _version, projectId: _projectId, sequence: _sequence, ...draft }) =>
    draft);
  if (canonicalWorkroomJson(persistedDrafts) === canonicalWorkroomJson(drafts)) {
    return deepFreeze(persisted);
  }
  if (persisted.length > 0) {
    throw new Error(
      'Project Profile Journal replay payload drift at registry revision '
      + expectedRevision,
    );
  }
  return undefined;
}

function parseSegment(
  value: string,
  projectId: string,
  fileFirstSequence: number,
): ProjectProfileJournalSegment {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error('Invalid Project Profile Journal segment JSON', { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid Project Profile Journal segment');
  }
  const segment = parsed as Partial<ProjectProfileJournalSegment>;
  if (segment.version !== 1
    || segment.projectId !== projectId
    || !Number.isSafeInteger(segment.expectedRegistryRevision)
    || !Number.isSafeInteger(segment.firstSequence)
    || !Number.isSafeInteger(segment.lastSequence)
    || !Array.isArray(segment.events)
    || typeof segment.payloadDigest !== 'string') {
    throw new Error('Invalid Project Profile Journal segment');
  }
  const segmentExpectedRevision = segment.expectedRegistryRevision as number;
  const segmentFirstSequence = segment.firstSequence as number;
  const segmentLastSequence = segment.lastSequence as number;
  const events = segment.events.map(parseEvent);
  if (segmentFirstSequence !== fileFirstSequence) {
    throw new Error('Project Profile Journal segment name position mismatch');
  }
  if (events.length === 0
    || events[0]!.sequence !== segmentFirstSequence
    || events.at(-1)!.sequence !== segmentLastSequence
    || segmentFirstSequence !== segmentExpectedRevision + 1) {
    throw new Error('Invalid Project Profile Journal segment position');
  }
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.projectId !== projectId || event.sequence !== segmentFirstSequence + index) {
      throw new Error('Invalid Project Profile Journal event position');
    }
  }
  const payload = deepFreeze<ProjectProfileJournalSegmentPayload>({
    version: 1,
    projectId,
    expectedRegistryRevision: segmentExpectedRevision,
    firstSequence: segmentFirstSequence,
    lastSequence: segmentLastSequence,
    events,
  });
  if (segment.payloadDigest !== digestCanonicalWorkroomValue(payload)) {
    throw new Error('Project Profile Journal segment payload digest mismatch');
  }
  return deepFreeze({ ...payload, payloadDigest: segment.payloadDigest });
}

function parseEvent(value: unknown): ProjectProfileEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Project Profile Journal event');
  }
  const event = value as Partial<ProjectProfileEvent>;
  if (event.version !== 1
    || typeof event.projectId !== 'string'
    || !Number.isSafeInteger(event.sequence)
    || !['profile.revision_registered', 'profile.revision_activated', 'run.profile_pinned']
      .includes(event.type ?? '')
    || !event.payload
    || typeof event.payload !== 'object'
    || Array.isArray(event.payload)) {
    throw new Error('Invalid Project Profile Journal event');
  }
  return deepFreeze(event as ProjectProfileEvent);
}

function identifier(value: string, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error('Invalid Project Profile Journal ' + name);
  }
  return value;
}

function expectedRegistryRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < -1) {
    throw new Error('Invalid Project Profile Journal expected registry revision');
  }
  return value;
}

function projectFilePrefix(projectId: string): string {
  return createHash('sha256').update(projectId).digest('hex') + '.';
}

function segmentNamePattern(prefix: string): RegExp {
  return new RegExp('^' + prefix.replace('.', '\\.') + '\\d{16}\\.json$', 'u');
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === 'EEXIST');
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT');
}
