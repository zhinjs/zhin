import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import {
  ConfigPatchPathError,
  type ConfigDocumentPort,
  type ConfigDocumentSnapshot,
  type ConfigPatch,
  type PreparedConfigDocument,
  type RuntimeConfigDocument,
} from '@zhin.js/runtime';
import { isMap, isSeq, parseDocument, type Document } from 'yaml';

export class YamlConfigDocumentError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'YamlConfigDocumentError';
  }
}

export class ConfigDocumentParseError extends YamlConfigDocumentError {
  constructor(readonly file: string, readonly issues: readonly string[]) {
    super(`Cannot parse YAML config ${file}:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'ConfigDocumentParseError';
  }
}

export class ConfigDocumentConflictError extends YamlConfigDocumentError {
  constructor(readonly file: string) {
    super(`YAML config changed since it was read: ${file}`);
    this.name = 'ConfigDocumentConflictError';
  }
}

export class YamlConfigDocument implements ConfigDocumentPort {
  readonly file: string;

  constructor(file: string) {
    this.file = resolve(file);
  }

  async read(): Promise<ConfigDocumentSnapshot> {
    const source = await readFile(this.file, 'utf8');
    return snapshot(parse(this.file, source), source);
  }

  async prepare(
    current: ConfigDocumentSnapshot,
    patches: readonly ConfigPatch[],
  ): Promise<PreparedConfigDocument> {
    const source = await readFile(this.file, 'utf8');
    assertRevision(this.file, source, current.revision);
    const document = parseYaml(this.file, source);
    for (const patch of patches) applyPatch(document, patch);

    const candidateSource = stringify(document, source);
    const candidate = parse(this.file, candidateSource);
    const fileMode = (await stat(this.file)).mode;
    return new PreparedYamlConfigDocument(
      this.file,
      source,
      current.revision,
      candidateSource,
      candidate,
      fileMode,
    );
  }
}

class PreparedYamlConfigDocument implements PreparedConfigDocument {
  readonly document: RuntimeConfigDocument;
  readonly #file: string;
  readonly #previousSource: string;
  readonly #previousRevision: string;
  readonly #candidateSource: string;
  readonly #mode: number;
  readonly #candidateRevision: string;
  #state: 'prepared' | 'committed' | 'rolled-back' = 'prepared';
  #committedSnapshot?: ConfigDocumentSnapshot;

  constructor(
    file: string,
    previousSource: string,
    previousRevision: string,
    candidateSource: string,
    document: RuntimeConfigDocument,
    mode: number,
  ) {
    this.#file = file;
    this.#previousSource = previousSource;
    this.#previousRevision = previousRevision;
    this.#candidateSource = candidateSource;
    this.#mode = mode;
    this.document = document;
    this.#candidateRevision = revision(candidateSource);
  }

  async commit(): Promise<ConfigDocumentSnapshot> {
    if (this.#state === 'committed') return requireSnapshot(this.#committedSnapshot);
    if (this.#state === 'rolled-back') {
      throw new YamlConfigDocumentError('A rolled-back YAML config transaction cannot commit');
    }
    const source = await readFile(this.#file, 'utf8');
    assertRevision(this.#file, source, this.#previousRevision);

    // Build every result before rename so successful replacement is the last
    // fallible step visible to callers.
    const committed = Object.freeze({
      document: this.document,
      revision: this.#candidateRevision,
    });
    await atomicReplace(this.#file, this.#candidateSource, this.#mode);
    this.#committedSnapshot = committed;
    this.#state = 'committed';
    return committed;
  }

  async rollback(): Promise<void> {
    if (this.#state !== 'committed') {
      if (this.#state === 'prepared') this.#state = 'rolled-back';
      return;
    }
    const source = await readFile(this.#file, 'utf8');
    assertRevision(this.#file, source, this.#candidateRevision);
    await atomicReplace(this.#file, this.#previousSource, this.#mode);
    this.#state = 'rolled-back';
  }
}

function parseYaml(file: string, source: string): Document {
  const document = parseDocument(source, { prettyErrors: true, strict: true });
  if (document.errors.length > 0) {
    throw new ConfigDocumentParseError(
      file,
      Object.freeze(document.errors.map((error) => error.message)),
    );
  }
  return document;
}

function parse(file: string, source: string): RuntimeConfigDocument {
  const value = parseYaml(file, source).toJS({ maxAliasCount: 100 }) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigDocumentParseError(file, ['The document root must be a mapping']);
  }
  return Object.freeze(value as Record<string, unknown>);
}

function applyPatch(document: Document, patch: ConfigPatch): void {
  assertPath(patch.path);
  if (patch.path.length === 0) {
    if (patch.op === 'remove') {
      throw new ConfigPatchPathError('The config document root cannot be removed');
    }
    if (!patch.value || typeof patch.value !== 'object' || Array.isArray(patch.value)) {
      throw new ConfigPatchPathError('The config document root must be an object');
    }
    document.contents = document.createNode(structuredClone(patch.value));
    return;
  }
  if (patch.op === 'set') document.setIn(resolvePath(document, patch.path), structuredClone(patch.value));
  else document.deleteIn(resolvePath(document, patch.path));
}

/**
 * Walks the AST so numeric segments address sequence elements (`endpoints.0.url`).
 * Non-numeric segments on a sequence and out-of-bounds indexes are rejected
 * with the same errors as the Runtime planner; missing intermediates are left
 * for `setIn` to create as mappings (matching planner semantics).
 */
function resolvePath(document: Document, path: readonly string[]): (string | number)[] {
  const resolved: (string | number)[] = [];
  let node: unknown = document.contents;
  for (const [index, segment] of path.entries()) {
    const isLast = index === path.length - 1;
    if (isSeq(node)) {
      if (!/^(0|[1-9]\d*)$/.test(segment)) {
        throw new ConfigPatchPathError(
          `Config path ${pointer(path.slice(0, index + 1))} requires an array index, got "${segment}"`,
        );
      }
      const arrayIndex = Number(segment);
      if (arrayIndex >= node.items.length) {
        throw new ConfigPatchPathError(
          `Config path ${pointer(path.slice(0, index + 1))} is out of bounds (array length ${node.items.length})`,
        );
      }
      resolved.push(arrayIndex);
      node = isLast ? undefined : node.get(arrayIndex, false);
    } else if (isMap(node)) {
      resolved.push(segment);
      node = isLast ? undefined : node.get(segment, false);
    } else if (node == null) {
      // Missing intermediate mapping (setIn creates it).
      resolved.push(segment);
      node = undefined;
    } else {
      throw new ConfigPatchPathError(
        `Config path ${pointer(path.slice(0, index + 1))} is not an object`,
      );
    }
  }
  return resolved;
}

function pointer(path: readonly string[]): string {
  if (path.length === 0) return '/';
  return `/${path.map((segment) => segment.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
}

function assertPath(path: readonly string[]): void {
  for (const segment of path) {
    if (!segment || segment === '__proto__' || segment === 'prototype' || segment === 'constructor') {
      throw new ConfigPatchPathError(`Unsafe config path segment: ${segment || '<empty>'}`);
    }
  }
}

function stringify(document: Document, original: string): string {
  const indentation = original.match(/^( +)\S/mu)?.[1].length ?? 2;
  const source = document.toString({ indent: indentation, lineWidth: 0 });
  return original.includes('\r\n') ? source.replaceAll('\n', '\r\n') : source;
}

function snapshot(
  document: RuntimeConfigDocument,
  source: string,
): ConfigDocumentSnapshot {
  return Object.freeze({ document, revision: revision(source) });
}

function revision(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

function assertRevision(file: string, source: string, expected: string): void {
  if (revision(source) !== expected) throw new ConfigDocumentConflictError(file);
}

async function atomicReplace(file: string, source: string, mode: number): Promise<void> {
  const temporary = `${basename(file)}.${process.pid}.${randomUUID()}.tmp`;
  const target = resolve(dirname(file), temporary);
  try {
    await writeFile(target, source, { mode });
    await rename(target, file);
  } catch (error) {
    await rm(target, { force: true }).catch(() => undefined);
    throw error;
  }
}

function requireSnapshot(
  value: ConfigDocumentSnapshot | undefined,
): ConfigDocumentSnapshot {
  if (!value) throw new Error('Committed YAML transaction has no snapshot');
  return value;
}
