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
import type {
  InteractionSpaceBinding,
  InteractionSpaceBindingRepository,
} from './interaction-space-router.js';

export interface InteractionSpaceBindingFileHandle {
  writeFile(value: string, encoding: 'utf8'): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

/** Injectable only at the durable filesystem boundary. */
export interface InteractionSpaceBindingFileSystem {
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<readonly string[]>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  open(path: string, flags: 'wx' | 'r'): Promise<InteractionSpaceBindingFileHandle>;
  link(existingPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

const nodeFileSystem: InteractionSpaceBindingFileSystem = Object.freeze({
  mkdir: async (path: string): Promise<void> => { await nodeMkdir(path); },
  readdir: async (path: string): Promise<readonly string[]> => await nodeReaddir(path),
  readFile: async (path: string, encoding: 'utf8'): Promise<string> =>
    await nodeReadFile(path, encoding),
  open: async (
    path: string,
    flags: 'wx' | 'r',
  ): Promise<InteractionSpaceBindingFileHandle> => await nodeOpen(path, flags),
  link: async (existingPath: string, newPath: string): Promise<void> =>
    await nodeLink(existingPath, newPath),
  unlink: async (path: string): Promise<void> => await nodeUnlink(path),
});

interface InteractionSpaceBindingSegmentPayload {
  readonly version: 1;
  readonly conversationKey: string;
  readonly expectedRevision: number;
  readonly firstBindingRevision: number;
  readonly lastBindingRevision: number;
  readonly bindings: readonly InteractionSpaceBinding[];
}

interface InteractionSpaceBindingSegment extends InteractionSpaceBindingSegmentPayload {
  readonly payloadDigest: string;
}

/**
 * Crash-durable Interaction Space binding history.
 *
 * The leaf directory is created non-recursively, so its parent must already be
 * durable. Immutable segments are published through a hard-link pathname whose
 * conversation-key hash and first binding revision form the cross-process CAS.
 */
export class FileInteractionSpaceBindingRepository
implements InteractionSpaceBindingRepository {
  constructor(
    readonly directory: string,
    readonly fileSystem: InteractionSpaceBindingFileSystem = nodeFileSystem,
  ) {}

  async read(conversationKey: string): Promise<readonly InteractionSpaceBinding[]> {
    const key = identifier(conversationKey, 'conversationKey');
    const bindings = await this.#readBindings(key);
    if (bindings.length > 0) await this.#syncPath(this.directory);
    return bindings;
  }

  async append(
    conversationKey: string,
    expectedRevision: number,
    values: readonly InteractionSpaceBinding[],
  ): Promise<readonly InteractionSpaceBinding[]> {
    const key = identifier(conversationKey, 'conversationKey');
    revision(expectedRevision, 'expectedRevision', true);
    const bindings = snapshotBindings(values, key);
    if (bindings.length === 0) {
      throw new Error('Interaction Space binding append requires facts');
    }
    const current = await this.#readBindings(key);
    const replay = exactReplay(current, expectedRevision, bindings);
    if (replay) {
      if (current.length > 0) await this.#syncPath(this.directory);
      return replay;
    }
    if (current.length !== expectedRevision) {
      throw revisionConflict(key, expectedRevision, current.length);
    }
    validateHistory(key, Object.freeze([...current, ...bindings]));

    const firstBindingRevision = bindings[0]!.bindingRevision;
    const payload = deepFreeze<InteractionSpaceBindingSegmentPayload>({
      version: 1,
      conversationKey: key,
      expectedRevision,
      firstBindingRevision,
      lastBindingRevision: bindings.at(-1)!.bindingRevision,
      bindings,
    });
    const segment = deepFreeze<InteractionSpaceBindingSegment>({
      ...payload,
      payloadDigest: digestCanonicalWorkroomValue(payload),
    });

    await this.#ensureDurableLeaf();
    const path = this.#segmentPath(key, firstBindingRevision);
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
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
      await this.#syncPath(this.directory);
    } catch (error) {
      if (temporaryExists) {
        await this.#removeTemporary(temporaryPath);
        temporaryExists = false;
      }
      if (!isAlreadyExists(error)) throw error;
      const winner = await this.#readBindings(key);
      const exact = exactReplay(winner, expectedRevision, bindings);
      await this.#syncPath(this.directory);
      if (exact) return exact;
      throw revisionConflict(key, expectedRevision, winner.length);
    } finally {
      if (temporaryExists) await this.#removeTemporary(temporaryPath);
    }
    return bindings;
  }

  async #readBindings(conversationKey: string): Promise<readonly InteractionSpaceBinding[]> {
    let names: readonly string[];
    try {
      names = await this.fileSystem.readdir(this.directory);
    } catch (error) {
      if (isMissingFile(error)) return Object.freeze([]);
      throw error;
    }
    const segmentNames = names.filter(name => name.endsWith('.json')).sort();
    const segments = await Promise.all(segmentNames.map(async name => parseSegment(
      await this.fileSystem.readFile(join(this.directory, name), 'utf8'),
      name,
    )));
    const selected = segments
      .filter(segment => segment.conversationKey === conversationKey)
      .sort((left, right) => left.firstBindingRevision - right.firstBindingRevision);
    const bindings: InteractionSpaceBinding[] = [];
    let expectedRevision = 0;
    for (const segment of selected) {
      if (segment.expectedRevision !== expectedRevision
        || segment.firstBindingRevision !== expectedRevision + 1) {
        throw new Error('Interaction Space binding segment revision gap');
      }
      bindings.push(...segment.bindings);
      expectedRevision = segment.lastBindingRevision;
    }
    const frozen = deepFreeze(bindings);
    validateHistory(conversationKey, frozen);
    return frozen;
  }

  #segmentPath(conversationKey: string, firstRevision: number): string {
    return join(this.directory, segmentName(conversationKey, firstRevision));
  }

  async #ensureDurableLeaf(): Promise<void> {
    try {
      await this.fileSystem.mkdir(this.directory);
    } catch (error) {
      if (!isAlreadyExists(error)) {
        if (isMissingFile(error)) {
          throw new Error(
            `Interaction Space binding repository requires a pre-existing durable parent directory: ${dirname(this.directory)}`,
            { cause: error },
          );
        }
        throw error;
      }
    }
    await this.#syncPath(dirname(this.directory));
  }

  async #syncPath(path: string): Promise<void> {
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

function snapshotBindings(
  values: readonly InteractionSpaceBinding[],
  conversationKey: string,
): readonly InteractionSpaceBinding[] {
  if (!Array.isArray(values)) throw new Error('Invalid Interaction Space binding facts');
  return deepFreeze(values.map(value => {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== 'string') throw new Error('Invalid Interaction Space binding fact');
    return parseBinding(JSON.parse(encoded), conversationKey);
  }));
}

function exactReplay(
  current: readonly InteractionSpaceBinding[],
  expectedRevision: number,
  bindings: readonly InteractionSpaceBinding[],
): readonly InteractionSpaceBinding[] | undefined {
  if (expectedRevision + bindings.length > current.length) return undefined;
  const persisted = current.slice(expectedRevision, expectedRevision + bindings.length);
  if (canonicalWorkroomJson(persisted) === canonicalWorkroomJson(bindings)) {
    return deepFreeze(persisted);
  }
  if (persisted.length > 0) {
    throw new Error(`Interaction Space binding replay payload drift at revision ${expectedRevision}`);
  }
  return undefined;
}

function parseSegment(value: string, name: string): InteractionSpaceBindingSegment {
  const match = /^([a-f0-9]{64})\.(\d{16})\.json$/u.exec(name);
  if (!match) throw new Error('Invalid Interaction Space binding segment name');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error('Invalid Interaction Space binding segment JSON', { cause: error });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid Interaction Space binding segment');
  }
  assertExactKeys(parsed as Record<string, unknown>, [
    'version', 'conversationKey', 'expectedRevision', 'firstBindingRevision',
    'lastBindingRevision', 'bindings', 'payloadDigest',
  ], 'segment');
  const segment = parsed as Partial<InteractionSpaceBindingSegment>;
  if (segment.version !== 1
    || typeof segment.conversationKey !== 'string'
    || !Number.isSafeInteger(segment.expectedRevision)
    || !Number.isSafeInteger(segment.firstBindingRevision)
    || !Number.isSafeInteger(segment.lastBindingRevision)
    || !Array.isArray(segment.bindings)
    || typeof segment.payloadDigest !== 'string') {
    throw new Error('Invalid Interaction Space binding segment');
  }
  const conversationKey = identifier(segment.conversationKey, 'conversationKey');
  const expectedRevision = revision(segment.expectedRevision, 'expectedRevision', true);
  const firstBindingRevision = revision(segment.firstBindingRevision, 'firstBindingRevision');
  const lastBindingRevision = revision(segment.lastBindingRevision, 'lastBindingRevision');
  if (match[1] !== conversationKeyHash(conversationKey)
    || Number(match[2]) !== firstBindingRevision) {
    throw new Error('Interaction Space binding segment name binding mismatch');
  }
  const bindings = deepFreeze(segment.bindings.map(binding => parseBinding(binding, conversationKey)));
  if (bindings.length === 0
    || firstBindingRevision !== expectedRevision + 1
    || bindings[0]!.bindingRevision !== firstBindingRevision
    || bindings.at(-1)!.bindingRevision !== lastBindingRevision) {
    throw new Error('Invalid Interaction Space binding segment position');
  }
  for (let index = 0; index < bindings.length; index += 1) {
    if (bindings[index]!.bindingRevision !== firstBindingRevision + index) {
      throw new Error('Invalid Interaction Space binding position');
    }
  }
  const payload = deepFreeze<InteractionSpaceBindingSegmentPayload>({
    version: 1,
    conversationKey,
    expectedRevision,
    firstBindingRevision,
    lastBindingRevision,
    bindings,
  });
  if (segment.payloadDigest !== digestCanonicalWorkroomValue(payload)) {
    throw new Error('Interaction Space binding segment payload digest mismatch');
  }
  validateHistory(conversationKey, bindings, firstBindingRevision - 1);
  return deepFreeze({ ...payload, payloadDigest: segment.payloadDigest });
}

function parseBinding(value: unknown, conversationKey: string): InteractionSpaceBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Interaction Space binding');
  }
  assertExactKeys(value as Record<string, unknown>, [
    'version', 'conversationKey', 'bindingRevision', 'effectiveAfterConversationSequence',
    'space', 'projectId', 'sourceRef', 'sourceDigest', 'digest',
  ], 'binding');
  const binding = value as Partial<InteractionSpaceBinding>;
  if (binding.version !== 1 || binding.conversationKey !== conversationKey) {
    throw new Error('Interaction Space binding conversation mismatch');
  }
  const bindingRevision = revision(binding.bindingRevision, 'bindingRevision');
  const effectiveAfterConversationSequence = revision(
    binding.effectiveAfterConversationSequence,
    'effectiveAfterConversationSequence',
    true,
  );
  if (binding.space !== 'chat' && binding.space !== 'workroom' && binding.space !== 'sponsor_room') {
    throw new Error('Invalid Interaction Space binding space');
  }
  const projectId = binding.projectId === undefined
    ? undefined
    : identifier(binding.projectId, 'projectId');
  if (binding.space === 'chat' && projectId !== undefined) {
    throw new Error('Interaction Space chat binding cannot carry projectId');
  }
  if (binding.space !== 'chat' && projectId === undefined) {
    throw new Error(`Interaction Space ${binding.space} binding requires projectId`);
  }
  const sourceRef = identifier(binding.sourceRef, 'sourceRef');
  const sourceDigest = sha256(binding.sourceDigest, 'sourceDigest');
  const projection = deepFreeze({
    version: 1 as const,
    conversationKey,
    bindingRevision,
    effectiveAfterConversationSequence,
    space: binding.space,
    ...(projectId === undefined ? {} : { projectId }),
    sourceRef,
    sourceDigest,
  });
  if (binding.digest !== digestCanonicalWorkroomValue(projection)) {
    throw new Error('Interaction Space binding digest mismatch');
  }
  return deepFreeze({ ...projection, digest: binding.digest });
}

function validateHistory(
  conversationKey: string,
  bindings: readonly InteractionSpaceBinding[],
  revisionOffset = 0,
): void {
  let previous: InteractionSpaceBinding | undefined;
  bindings.forEach((value, index) => {
    const binding = parseBinding(value, conversationKey);
    if (binding.bindingRevision !== revisionOffset + index + 1) {
      throw new Error('Interaction Space binding revisions must be contiguous');
    }
    if (previous
      && binding.effectiveAfterConversationSequence
        <= previous.effectiveAfterConversationSequence) {
      throw new Error('Interaction Space binding anchor must increase');
    }
    previous = binding;
  });
}

function segmentName(conversationKey: string, firstRevision: number): string {
  return `${conversationKeyHash(conversationKey)}.${String(firstRevision).padStart(16, '0')}.json`;
}

function conversationKeyHash(conversationKey: string): string {
  return createHash('sha256').update(conversationKey).digest('hex');
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Invalid Interaction Space binding ${field}`);
  }
  return value;
}

function revision(value: unknown, field: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || (value as number) < (allowZero ? 0 : 1)) {
    throw new Error(`Invalid Interaction Space binding ${field}`);
  }
  return value as number;
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Invalid Interaction Space binding ${field}`);
  }
  return value;
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allow = new Set(allowed);
  const unexpected = Object.keys(value).find(key => !allow.has(key));
  if (unexpected) throw new Error(`Invalid Interaction Space binding ${label} field: ${unexpected}`);
}

function revisionConflict(conversationKey: string, expected: number, actual: number): Error {
  return new Error(
    `Interaction Space binding ${conversationKey} revision conflict: expected ${expected}, actual ${actual}`,
  );
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === 'EEXIST');
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT');
}
