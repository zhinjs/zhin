import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ProjectMemoryStateRevisionConflictError,
  assertProjectMemoryApplicationEvent,
  createProjectMemoryApplicationEvent,
  findExactProjectMemoryApplicationReplay,
  replayProjectMemoryApplication,
  type ProjectMemoryApplicationRepository,
  type WorkroomAcceptedSourceApplicationEvent,
} from './accepted-source-memory-application.js';
import type { WorkroomAcceptedSourceProjection } from './accepted-source-projector.js';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';
import { DurableFileStore } from './durable-file-store.js';

interface ProjectMemorySegmentPayload {
  readonly version: 1;
  readonly projectId: string;
  readonly expectedStateRevision: number;
  readonly event: WorkroomAcceptedSourceApplicationEvent;
}

interface ProjectMemorySegment extends ProjectMemorySegmentPayload {
  readonly payloadDigest: string;
}

/**
 * Crash-durable accepted-source journal. Each State Revision is published by a
 * create-only hard link; its immutable segment contains Task Memory, State
 * Patch and the context-release eligibility in one atomic fact.
 */
export class FileProjectMemoryApplicationRepository implements ProjectMemoryApplicationRepository {
  readonly #store: DurableFileStore;

  constructor(readonly directory: string) {
    this.#store = new DurableFileStore(directory);
  }

  async read(projectId: string): Promise<readonly WorkroomAcceptedSourceApplicationEvent[]> {
    const id = canonicalId(projectId);
    const prefix = projectPrefix(id);
    let names: readonly string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return Object.freeze([]);
      throw error;
    }
    const candidates = names.filter(name => name.startsWith(prefix));
    if (candidates.some(name => !segmentPattern(prefix).test(name))) {
      throw new Error('Invalid Project Memory Journal segment name');
    }
    const events = await Promise.all(candidates.sort().map(async name =>
      (await parseSegment(
        await readFile(join(this.directory, name), 'utf8'),
        id,
        Number(name.slice(prefix.length, prefix.length + 16)),
      )).event));
    replayProjectMemoryApplication(id, events);
    if (events.length > 0) await this.#store.syncLeaf();
    return deepFreeze(events);
  }

  async append(
    projectId: string,
    expectedStateRevision: number,
    projection: WorkroomAcceptedSourceProjection,
  ): Promise<WorkroomAcceptedSourceApplicationEvent> {
    const id = canonicalId(projectId);
    assertRevision(expectedStateRevision);
    const current = await this.read(id);
    const replay = findExactProjectMemoryApplicationReplay(current, projection);
    if (replay) return replay;
    const actual = current.at(-1)?.stateRevision ?? 0;
    if (actual !== expectedStateRevision) {
      throw new ProjectMemoryStateRevisionConflictError(id, expectedStateRevision, actual);
    }
    const event = createProjectMemoryApplicationEvent(id, expectedStateRevision + 1, projection);
    replayProjectMemoryApplication(id, Object.freeze([...current, event]));
    const payload = deepFreeze<ProjectMemorySegmentPayload>({
      version: 1,
      projectId: id,
      expectedStateRevision,
      event,
    });
    const segment = deepFreeze<ProjectMemorySegment>({
      ...payload,
      payloadDigest: digest(payload),
    });
    await this.#store.ensureDurableLeaf('Project Memory Journal');
    const target = join(this.directory, segmentName(id, event.stateRevision));
    const published = await this.#store.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(segment),
      createdValue: event,
      onConflict: async () => {
        const winner = await this.read(id);
        const exact = findExactProjectMemoryApplicationReplay(winner, projection);
        if (exact) return exact;
        throw new ProjectMemoryStateRevisionConflictError(
          id,
          expectedStateRevision,
          winner.at(-1)?.stateRevision ?? 0,
        );
      },
    });
    return published.value;
  }
}

async function parseSegment(
  serialized: string,
  projectId: string,
  stateRevision: number,
): Promise<ProjectMemorySegment> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error('Project Memory Journal segment is not valid JSON', { cause: error });
  }
  if (!isRecord(parsed) || parsed.version !== 1 || parsed.projectId !== projectId
    || parsed.expectedStateRevision !== stateRevision - 1 || !isRecord(parsed.event)
    || typeof parsed.payloadDigest !== 'string') {
    throw new Error('Invalid Project Memory Journal segment');
  }
  const segment = parsed as unknown as ProjectMemorySegment;
  const payload: ProjectMemorySegmentPayload = {
    version: segment.version,
    projectId: segment.projectId,
    expectedStateRevision: segment.expectedStateRevision,
    event: segment.event,
  };
  if (segment.payloadDigest !== digest(payload)) {
    throw new Error('Project Memory Journal segment digest mismatch');
  }
  assertProjectMemoryApplicationEvent(segment.event, projectId, stateRevision);
  return deepFreeze(segment);
}

function projectPrefix(projectId: string): string {
  return createHash('sha256').update(projectId).digest('hex') + '.';
}

function segmentName(projectId: string, revision: number): string {
  return projectPrefix(projectId) + String(revision).padStart(16, '0') + '.json';
}

function segmentPattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}[0-9]{16}\\.json$`, 'u');
}

function canonicalId(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new Error('projectId must be a non-empty canonical string');
  }
  return value;
}

function assertRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid Project State revision');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code);
}
