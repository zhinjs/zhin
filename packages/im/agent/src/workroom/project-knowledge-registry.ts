import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  canonicalWorkroomJson,
  deepFreezeWorkroomValue as deepFreeze,
  digestCanonicalWorkroomValue as digest,
} from './canonical-value.js';
import { DurableFileStore } from './durable-file-store.js';
import type { CapabilityPackRef } from './profile-compiler.js';

export type ProjectKnowledgeSource =
  | Readonly<{ kind: 'acceptance_record'; projectId: string; sourceId: string; digest: string }>
  | Readonly<{
      kind: 'accepted_task_memory'; projectId: string; sourceId: string; acceptanceId: string; digest: string;
    }>
  | Readonly<{ kind: 'sponsor_decision'; projectId: string; sourceId: string; digest: string }>
  | Readonly<{
      kind: 'trusted_pack_publication'; projectId: string; sourceId: string; packRef: CapabilityPackRef; digest: string;
    }>;

export interface ProjectKnowledgeGovernedHandle {
  readonly ref: string;
  readonly digest: string;
}

export interface ProjectKnowledgeEntryInput {
  readonly version: 1;
  readonly projectId: string;
  readonly knowledgeId: string;
  readonly kind: 'memory' | 'glossary';
  /** Content-addressed governed handle only. The registry never stores body/display text. */
  readonly governedContent: ProjectKnowledgeGovernedHandle;
  readonly schema: ProjectKnowledgeGovernedHandle;
  readonly sensitivity: 'standard' | 'restricted' | 'high';
  readonly selectors: readonly string[];
}

export interface ProjectKnowledgeEntry extends ProjectKnowledgeEntryInput {
  readonly digest: string;
}

export function createProjectKnowledgeEntry(input: ProjectKnowledgeEntryInput): ProjectKnowledgeEntry {
  assertKeys(input, [
    'version', 'projectId', 'knowledgeId', 'kind', 'governedContent', 'schema', 'sensitivity', 'selectors',
  ], 'Project Knowledge entry');
  if (input.version !== 1 || !['memory', 'glossary'].includes(input.kind)) {
    throw new Error('Project Knowledge entry version/kind is invalid');
  }
  if (!['standard', 'restricted', 'high'].includes(input.sensitivity)) {
    throw new Error('Project Knowledge sensitivity is invalid');
  }
  const body = deepFreeze({
    version: 1 as const,
    projectId: text(input.projectId, 'Knowledge projectId'),
    knowledgeId: text(input.knowledgeId, 'Knowledge knowledgeId'),
    kind: input.kind,
    governedContent: handle(input.governedContent, 'Knowledge governed content'),
    schema: handle(input.schema, 'Knowledge schema'),
    sensitivity: input.sensitivity,
    selectors: unique(input.selectors, 'Knowledge selector'),
  });
  return deepFreeze({ ...body, digest: digest(body) });
}

export interface ProjectKnowledgeEvent {
  readonly version: 1;
  readonly projectId: string;
  readonly revision: number;
  readonly type: 'project_knowledge.published' | 'project_knowledge.rolled_back';
  readonly operationId: string;
  readonly commandDigest: string;
  readonly ownerPrincipalId: string;
  readonly source: ProjectKnowledgeSource;
  readonly restoredFromRevision?: number;
  readonly entries: readonly ProjectKnowledgeEntry[];
  readonly digest: string;
}

export interface ProjectKnowledgeSnapshot {
  readonly projectId: string;
  readonly revision: number;
  readonly entries: readonly ProjectKnowledgeEntry[];
  readonly history: readonly ProjectKnowledgeEvent[];
}

export interface ProjectKnowledgeJournal {
  read(projectId: string): Promise<readonly ProjectKnowledgeEvent[]>;
  append(projectId: string, expectedRevision: number, event: ProjectKnowledgeEvent): Promise<ProjectKnowledgeEvent>;
}

export class ProjectKnowledgeRevisionConflictError extends Error {
  constructor(readonly projectId: string, readonly expectedRevision: number, readonly actualRevision: number) {
    super(`Project Knowledge ${projectId} revision conflict: expected ${expectedRevision}, actual ${actualRevision}`);
    this.name = 'ProjectKnowledgeRevisionConflictError';
  }
}

export class MemoryProjectKnowledgeJournal implements ProjectKnowledgeJournal {
  readonly #projects = new Map<string, readonly ProjectKnowledgeEvent[]>();

  async read(projectId: string): Promise<readonly ProjectKnowledgeEvent[]> {
    return this.#projects.get(text(projectId, 'Knowledge projectId')) ?? Object.freeze([]);
  }

  async append(projectId: string, expectedRevision: number, event: ProjectKnowledgeEvent): Promise<ProjectKnowledgeEvent> {
    const current = await this.read(projectId);
    const replay = current.find(value => value.operationId === event.operationId);
    if (replay) {
      if (replay.commandDigest !== event.commandDigest) throw new Error('Project Knowledge operation identity drift');
      return replay;
    }
    const actual = current.at(-1)?.revision ?? -1;
    if (actual !== expectedRevision) throw new ProjectKnowledgeRevisionConflictError(projectId, expectedRevision, actual);
    assertProjectKnowledgeEvent(event, projectId, expectedRevision + 1);
    this.#projects.set(projectId, deepFreeze([...current, event]));
    return event;
  }
}

export class FileProjectKnowledgeJournal implements ProjectKnowledgeJournal {
  readonly #store: DurableFileStore;

  constructor(readonly directory: string) {
    this.#store = new DurableFileStore(directory);
  }

  async read(projectId: string): Promise<readonly ProjectKnowledgeEvent[]> {
    const id = text(projectId, 'Knowledge projectId');
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
      throw new Error('Invalid Project Knowledge Journal segment name');
    }
    const events = await Promise.all(candidates.sort().map(async name => {
      const revision = Number(name.slice(prefix.length, prefix.length + 16));
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(join(this.directory, name), 'utf8'));
      } catch (error) {
        throw new Error('Project Knowledge Journal segment is not valid JSON', { cause: error });
      }
      if (!isRecord(parsed)) throw new Error('Project Knowledge Journal segment is malformed');
      const event = parsed as unknown as ProjectKnowledgeEvent;
      assertProjectKnowledgeEvent(event, id, revision);
      return canonicalEvent(event);
    }));
    replayProjectKnowledge(id, events);
    if (events.length > 0) await this.#store.syncLeaf();
    return deepFreeze(events);
  }

  async append(projectId: string, expectedRevision: number, event: ProjectKnowledgeEvent): Promise<ProjectKnowledgeEvent> {
    const id = text(projectId, 'Knowledge projectId');
    const current = await this.read(id);
    const replay = current.find(value => value.operationId === event.operationId);
    if (replay) {
      if (replay.commandDigest !== event.commandDigest) throw new Error('Project Knowledge operation identity drift');
      return replay;
    }
    const actual = current.at(-1)?.revision ?? -1;
    if (actual !== expectedRevision) throw new ProjectKnowledgeRevisionConflictError(id, expectedRevision, actual);
    assertProjectKnowledgeEvent(event, id, expectedRevision + 1);
    await this.#store.ensureDurableLeaf('Project Knowledge Journal');
    const target = join(this.directory, segmentName(id, event.revision));
    const result = await this.#store.publishCreateOnly({
      target,
      content: canonicalWorkroomJson(event),
      createdValue: event,
      onConflict: async () => {
        const winner = (await this.read(id)).find(value => value.revision === event.revision);
        if (winner?.operationId === event.operationId && winner.commandDigest === event.commandDigest) return winner;
        throw new ProjectKnowledgeRevisionConflictError(id, expectedRevision, (await this.read(id)).at(-1)?.revision ?? -1);
      },
    });
    await this.#store.syncLeafAndParent();
    return result.value;
  }
}

export interface ProjectKnowledgeGenerationViewPort {
  withCurrent<TResult>(
    input: Readonly<{ generation: number; operationId: string; signal: AbortSignal }>,
    use: () => TResult | Promise<TResult>,
  ): Promise<TResult>;
}

export interface ProjectKnowledgeSourceAuthorityPort {
  verify(source: ProjectKnowledgeSource): Promise<boolean>;
}

export interface PublishProjectKnowledgeCommand {
  readonly version: 1;
  readonly generation: number;
  readonly operationId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly ownerPrincipalId: string;
  readonly source: ProjectKnowledgeSource;
  readonly entries: readonly ProjectKnowledgeEntry[];
}

export interface RollbackProjectKnowledgeCommand extends Omit<PublishProjectKnowledgeCommand, 'entries'> {
  readonly restoreRevision: number;
}

export interface LoadProjectKnowledgeQuery {
  readonly projectId: string;
  readonly knowledgeIds: readonly string[];
  readonly kinds?: readonly ProjectKnowledgeEntry['kind'][];
}

export class ProjectKnowledgeRegistry {
  constructor(readonly options: Readonly<{
    journal: ProjectKnowledgeJournal;
    generationView: ProjectKnowledgeGenerationViewPort;
    sourceAuthority: ProjectKnowledgeSourceAuthorityPort;
  }>) {}

  async read(projectId: string): Promise<ProjectKnowledgeSnapshot> {
    const id = text(projectId, 'Knowledge projectId');
    const events = await this.options.journal.read(id);
    for (const event of events) {
      if (!await this.options.sourceAuthority.verify(event.source)) {
        throw new Error('Project Knowledge persisted source verification denied');
      }
    }
    return replayProjectKnowledge(id, events);
  }

  async load(query: LoadProjectKnowledgeQuery): Promise<Readonly<{ projectId: string; revision: number; entries: readonly ProjectKnowledgeEntry[] }>> {
    assertKeys(query, ['projectId', 'knowledgeIds', ...(query.kinds ? ['kinds'] : [])], 'Project Knowledge query');
    const state = await this.read(query.projectId);
    const ids = new Set(unique(query.knowledgeIds, 'Knowledge query id'));
    const kinds = query.kinds ? new Set(unique(query.kinds, 'Knowledge query kind')) : undefined;
    return deepFreeze({
      projectId: state.projectId,
      revision: state.revision,
      entries: state.entries.filter(entry => ids.has(entry.knowledgeId) && (!kinds || kinds.has(entry.kind))),
    });
  }

  async publish(command: PublishProjectKnowledgeCommand, signal: AbortSignal): Promise<ProjectKnowledgeSnapshot> {
    assertKeys(command, [
      'version', 'generation', 'operationId', 'projectId', 'expectedRevision', 'ownerPrincipalId', 'source', 'entries',
    ], 'Project Knowledge publish command');
    commandHeader(command, signal);
    return await this.options.generationView.withCurrent({
      generation: command.generation, operationId: command.operationId, signal,
    }, async () => {
      const source = await this.#source(command.source, command.projectId);
      const suppliedEntries = command.entries.map(canonicalEntry);
      const commandDigest = digest({ ...structuredClone(command), source, entries: suppliedEntries });
      const state = await this.read(command.projectId);
      const replay = state.history.find(event => event.operationId === command.operationId);
      if (replay) {
        if (replay.commandDigest !== commandDigest) throw new Error('Project Knowledge operation identity drift');
        return state;
      }
      if (state.revision !== command.expectedRevision) {
        throw new ProjectKnowledgeRevisionConflictError(command.projectId, command.expectedRevision, state.revision);
      }
      const next = new Map(state.entries.map(entry => [entry.knowledgeId, entry]));
      for (const entry of suppliedEntries) {
        if (entry.projectId !== command.projectId) throw new Error('Project Knowledge entry Project binding mismatch');
        const current = next.get(entry.knowledgeId);
        if (current && current.digest !== entry.digest && source.kind !== 'sponsor_decision') {
          throw new Error('Sponsor Decision is required to replace conflicting Project Knowledge');
        }
        next.set(entry.knowledgeId, entry);
      }
      const entries = [...next.values()].sort(byKnowledgeId);
      const event = createEvent({
        projectId: command.projectId, revision: state.revision + 1, type: 'project_knowledge.published',
        operationId: command.operationId, commandDigest, ownerPrincipalId: command.ownerPrincipalId,
        source, entries,
      });
      await this.options.journal.append(command.projectId, state.revision, event);
      return await this.read(command.projectId);
    });
  }

  async rollback(command: RollbackProjectKnowledgeCommand, signal: AbortSignal): Promise<ProjectKnowledgeSnapshot> {
    assertKeys(command, [
      'version', 'generation', 'operationId', 'projectId', 'expectedRevision', 'ownerPrincipalId', 'source', 'restoreRevision',
    ], 'Project Knowledge rollback command');
    commandHeader(command, signal);
    if (!Number.isSafeInteger(command.restoreRevision) || command.restoreRevision < 0) {
      throw new Error('Invalid Project Knowledge restore revision');
    }
    return await this.options.generationView.withCurrent({
      generation: command.generation, operationId: command.operationId, signal,
    }, async () => {
      const source = await this.#source(command.source, command.projectId);
      if (source.kind !== 'sponsor_decision') throw new Error('Sponsor Decision is required for Project Knowledge rollback');
      const commandDigest = digest({ ...structuredClone(command), source });
      const state = await this.read(command.projectId);
      const replay = state.history.find(event => event.operationId === command.operationId);
      if (replay) {
        if (replay.commandDigest !== commandDigest) throw new Error('Project Knowledge operation identity drift');
        return state;
      }
      if (state.revision !== command.expectedRevision) {
        throw new ProjectKnowledgeRevisionConflictError(command.projectId, command.expectedRevision, state.revision);
      }
      const restored = state.history.find(event => event.revision === command.restoreRevision);
      if (!restored) throw new Error(`Project Knowledge restore revision ${command.restoreRevision} not found`);
      const event = createEvent({
        projectId: command.projectId, revision: state.revision + 1, type: 'project_knowledge.rolled_back',
        operationId: command.operationId, commandDigest, ownerPrincipalId: command.ownerPrincipalId,
        source, restoredFromRevision: command.restoreRevision, entries: restored.entries,
      });
      await this.options.journal.append(command.projectId, state.revision, event);
      return await this.read(command.projectId);
    });
  }

  async #source(source: ProjectKnowledgeSource, projectId: string): Promise<ProjectKnowledgeSource> {
    const canonical = canonicalProjectKnowledgeSource(source);
    if (canonical.projectId !== projectId) throw new Error('Project Knowledge source Project binding mismatch');
    if (!await this.options.sourceAuthority.verify(canonical)) {
      throw new Error('Project Knowledge trusted source verification denied');
    }
    return canonical;
  }
}

export function replayProjectKnowledge(projectId: string, events: readonly ProjectKnowledgeEvent[]): ProjectKnowledgeSnapshot {
  let expected = 0;
  const history: ProjectKnowledgeEvent[] = [];
  const operationIds = new Set<string>();
  let previous = new Map<string, ProjectKnowledgeEntry>();
  for (const event of events) {
    assertProjectKnowledgeEvent(event, projectId, expected++);
    if (operationIds.has(event.operationId)) throw new Error('Duplicate Project Knowledge operationId');
    operationIds.add(event.operationId);
    const next = new Map(event.entries.map(entry => [entry.knowledgeId, entry]));
    if (event.type === 'project_knowledge.published') {
      const conflicts = [...next].some(([id, entry]) => previous.has(id) && previous.get(id)?.digest !== entry.digest);
      if (conflicts && event.source.kind !== 'sponsor_decision') {
        throw new Error('Sponsor Decision is required to replay conflicting Project Knowledge');
      }
      if (event.restoredFromRevision !== undefined) throw new Error('Published Project Knowledge cannot be a rollback');
    } else {
      if (event.source.kind !== 'sponsor_decision' || event.restoredFromRevision === undefined) {
        throw new Error('Sponsor Decision is required to replay Project Knowledge rollback');
      }
      const restored = history.find(value => value.revision === event.restoredFromRevision);
      if (!restored || canonicalWorkroomJson(restored.entries) !== canonicalWorkroomJson(event.entries)) {
        throw new Error('Project Knowledge rollback snapshot binding mismatch');
      }
    }
    previous = next;
    history.push(event);
  }
  return deepFreeze({
    projectId,
    revision: events.at(-1)?.revision ?? -1,
    entries: events.at(-1)?.entries ?? [],
    history,
  });
}

function createEvent(input: Omit<ProjectKnowledgeEvent, 'version' | 'digest'>): ProjectKnowledgeEvent {
  const body = deepFreeze({ version: 1 as const, ...structuredClone(input) });
  return deepFreeze({ ...body, digest: digest(body) });
}

function canonicalEvent(event: ProjectKnowledgeEvent): ProjectKnowledgeEvent {
  assertKeys(event, [
    'version', 'projectId', 'revision', 'type', 'operationId', 'commandDigest', 'ownerPrincipalId',
    'source', 'entries', ...(event.restoredFromRevision !== undefined ? ['restoredFromRevision'] : []), 'digest',
  ], 'Project Knowledge event');
  return createEvent({
    projectId: event.projectId,
    revision: event.revision,
    type: event.type,
    operationId: event.operationId,
    commandDigest: event.commandDigest,
    ownerPrincipalId: event.ownerPrincipalId,
    source: event.source,
    ...(event.restoredFromRevision !== undefined ? { restoredFromRevision: event.restoredFromRevision } : {}),
    entries: event.entries,
  });
}

function assertProjectKnowledgeEvent(event: ProjectKnowledgeEvent, projectId: string, revision: number): void {
  const canonical = canonicalEvent(event);
  if (event.version !== 1 || event.projectId !== projectId || event.revision !== revision
    || !['project_knowledge.published', 'project_knowledge.rolled_back'].includes(event.type)
    || event.digest !== canonical.digest || canonicalWorkroomJson(event) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Invalid Project Knowledge Journal event');
  }
  canonicalProjectKnowledgeSource(event.source);
  if (event.source.projectId !== projectId) throw new Error('Project Knowledge event source Project binding mismatch');
  text(event.ownerPrincipalId, 'Knowledge event owner principalId');
  text(event.operationId, 'Knowledge event operationId');
  requiredDigest(event.commandDigest, 'Knowledge event command digest');
  if (event.restoredFromRevision !== undefined
    && (!Number.isSafeInteger(event.restoredFromRevision) || event.restoredFromRevision < 0)) {
    throw new Error('Knowledge event restored revision is invalid');
  }
  const knowledgeIds = event.entries.map(entry => entry.knowledgeId);
  if (new Set(knowledgeIds).size !== knowledgeIds.length
    || canonicalWorkroomJson(knowledgeIds) !== canonicalWorkroomJson([...knowledgeIds].sort())) {
    throw new Error('Project Knowledge event entries must be unique and sorted');
  }
  event.entries.forEach(entry => {
    if (canonicalEntry(entry).projectId !== projectId) throw new Error('Project Knowledge event Project binding mismatch');
  });
}

function canonicalEntry(value: ProjectKnowledgeEntry): ProjectKnowledgeEntry {
  const { digest: supplied, ...input } = value;
  const canonical = createProjectKnowledgeEntry(input);
  if (supplied !== canonical.digest || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Project Knowledge entry digest mismatch');
  }
  return canonical;
}

export function canonicalProjectKnowledgeSource(value: ProjectKnowledgeSource): ProjectKnowledgeSource {
  if (!isRecord(value) || !['acceptance_record', 'accepted_task_memory', 'sponsor_decision', 'trusted_pack_publication']
    .includes(String(value.kind))) throw new Error('Invalid Project Knowledge source kind');
  const keys = ['kind', 'projectId', 'sourceId', 'digest'];
  if (value.kind === 'accepted_task_memory') keys.push('acceptanceId');
  if (value.kind === 'trusted_pack_publication') keys.push('packRef');
  assertKeys(value, keys, 'Project Knowledge source');
  const body = {
    kind: value.kind,
    projectId: text(value.projectId, 'Knowledge source projectId'),
    sourceId: text(value.sourceId, 'Knowledge sourceId'),
    ...(value.kind === 'accepted_task_memory'
      ? { acceptanceId: text(value.acceptanceId, 'Knowledge source acceptanceId') }
      : {}),
    ...(value.kind === 'trusted_pack_publication'
      ? { packRef: packRef(value.packRef) }
      : {}),
  } as Omit<ProjectKnowledgeSource, 'digest'>;
  const canonical = deepFreeze({ ...body, digest: digest(body) }) as ProjectKnowledgeSource;
  if (value.digest !== canonical.digest || canonicalWorkroomJson(value) !== canonicalWorkroomJson(canonical)) {
    throw new Error('Project Knowledge source digest mismatch');
  }
  return canonical;
}

function commandHeader(command: PublishProjectKnowledgeCommand | RollbackProjectKnowledgeCommand, signal: AbortSignal): void {
  if (command.version !== 1 || !Number.isSafeInteger(command.generation) || command.generation < 0
    || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < -1) {
    throw new Error('Project Knowledge command position is invalid');
  }
  text(command.operationId, 'Knowledge operationId');
  text(command.projectId, 'Knowledge projectId');
  text(command.ownerPrincipalId, 'Knowledge owner principalId');
  signal.throwIfAborted();
}

function handle(value: ProjectKnowledgeGovernedHandle, label: string): ProjectKnowledgeGovernedHandle {
  assertKeys(value, ['ref', 'digest'], label);
  return deepFreeze({ ref: text(value.ref, `${label} ref`), digest: requiredDigest(value.digest, `${label} digest`) });
}

function packRef(value: CapabilityPackRef): CapabilityPackRef {
  assertKeys(value, ['id', 'version', 'digest'], 'Knowledge source Pack ref');
  return deepFreeze({ id: text(value.id, 'Pack id'), version: text(value.version, 'Pack version'), digest: requiredDigest(value.digest, 'Pack digest') });
}

function assertKeys(value: object, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (canonicalWorkroomJson(actual) !== canonicalWorkroomJson(allowed)) throw new Error(`${label} keys are invalid`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw new Error(`${label} is invalid`);
  return value;
}

function requiredDigest(value: unknown, label: string): string {
  const result = text(value, label);
  if (!result.startsWith('sha256:')) throw new Error(`${label} is invalid`);
  return result;
}

function unique(values: readonly string[], label: string): readonly string[] {
  const result = [...values].map(value => text(value, label)).sort();
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates`);
  return deepFreeze(result);
}

function byKnowledgeId(left: ProjectKnowledgeEntry, right: ProjectKnowledgeEntry): number {
  return left.knowledgeId.localeCompare(right.knowledgeId);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === code);
}
