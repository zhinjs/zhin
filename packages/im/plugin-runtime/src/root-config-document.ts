export type RuntimeConfigDocument = Readonly<Record<string, unknown>>;

export type ConfigPatch =
  | {
      readonly op: 'set';
      readonly path: readonly string[];
      readonly value: unknown;
    }
  | {
      readonly op: 'remove';
      readonly path: readonly string[];
    };

export interface ConfigDocumentSnapshot {
  readonly document: RuntimeConfigDocument;
  readonly revision: string;
}

/** A prepared write is inert until the generation handoff activates it. */
export interface PreparedConfigDocument {
  readonly document: RuntimeConfigDocument;
  commit(): Promise<ConfigDocumentSnapshot>;
  rollback(): Promise<void>;
}

export interface ConfigDocumentPort {
  /** Files whose external edits invalidate this document snapshot. */
  readonly sources?: readonly string[];
  read(): Promise<ConfigDocumentSnapshot>;
  prepare(
    current: ConfigDocumentSnapshot,
    patches: readonly ConfigPatch[],
  ): Promise<PreparedConfigDocument>;
}

export class ConfigDocumentDivergenceError extends Error {
  constructor() {
    super('ConfigDocument adapter candidate differs from the validated Runtime candidate');
    this.name = 'ConfigDocumentDivergenceError';
  }
}

export class ConfigPatchPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigPatchPathError';
  }
}

/** Applies structural patches without mutating the source document. */
export function applyConfigPatches(
  document: RuntimeConfigDocument,
  patches: readonly ConfigPatch[],
): RuntimeConfigDocument {
  let candidate = structuredClone(document) as Record<string, unknown>;
  for (const patch of patches) candidate = applyConfigPatch(candidate, patch);
  return Object.freeze(candidate);
}

function applyConfigPatch(
  document: Record<string, unknown>,
  patch: ConfigPatch,
): Record<string, unknown> {
  assertPath(patch.path);
  if (patch.path.length === 0) {
    if (patch.op === 'remove') {
      throw new ConfigPatchPathError('The config document root cannot be removed');
    }
    return cloneDocument(patch.value);
  }
  if (patch.op === 'set') setValue(document, patch.path, structuredClone(patch.value));
  else removeValue(document, patch.path);
  return document;
}

function setValue(
  document: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): void {
  let target: Record<string, unknown> | unknown[] = document;
  for (const [index, segment] of path.slice(0, -1).entries()) {
    const existing = readChild(target, segment, path.slice(0, index + 1));
    if (existing === undefined) {
      const created: Record<string, unknown> = {};
      (target as Record<string, unknown>)[segment] = created;
      target = created;
    } else {
      target = requireContainer(existing, path.slice(0, index + 1));
    }
  }
  writeChild(target, lastSegment(path), value, path);
}

function removeValue(document: Record<string, unknown>, path: readonly string[]): void {
  let target: Record<string, unknown> | unknown[] = document;
  for (const [index, segment] of path.slice(0, -1).entries()) {
    const existing = readChild(target, segment, path.slice(0, index + 1));
    if (existing === undefined) return;
    target = requireContainer(existing, path.slice(0, index + 1));
  }
  const segment = lastSegment(path);
  if (Array.isArray(target)) {
    target.splice(arrayIndex(segment, target, path), 1);
    return;
  }
  delete target[segment];
}

function cloneDocument(value: unknown): Record<string, unknown> {
  const document = structuredClone(value);
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new ConfigPatchPathError('The config document root must be an object');
  }
  return document as Record<string, unknown>;
}

function readChild(
  container: Record<string, unknown> | unknown[],
  segment: string,
  path: readonly string[],
): unknown {
  if (Array.isArray(container)) return container[arrayIndex(segment, container, path)];
  return container[segment];
}

function writeChild(
  container: Record<string, unknown> | unknown[],
  segment: string,
  value: unknown,
  path: readonly string[],
): void {
  if (Array.isArray(container)) {
    container[arrayIndex(segment, container, path)] = value;
    return;
  }
  container[segment] = value;
}

function arrayIndex(
  segment: string,
  container: readonly unknown[],
  path: readonly string[],
): number {
  if (!/^(0|[1-9]\d*)$/.test(segment)) {
    throw new ConfigPatchPathError(
      `Config path ${pointer(path)} requires an array index, got "${segment}"`,
    );
  }
  const index = Number(segment);
  if (index >= container.length) {
    throw new ConfigPatchPathError(
      `Config path ${pointer(path)} is out of bounds (array length ${container.length})`,
    );
  }
  return index;
}

function requireContainer(
  value: unknown,
  path: readonly string[],
): Record<string, unknown> | unknown[] {
  if (!value || typeof value !== 'object') {
    throw new ConfigPatchPathError(`Config path ${pointer(path)} is not an object`);
  }
  return value as Record<string, unknown> | unknown[];
}

function assertPath(path: readonly string[]): void {
  for (const segment of path) {
    if (!segment || segment === '__proto__' || segment === 'prototype' || segment === 'constructor') {
      throw new ConfigPatchPathError(`Unsafe config path segment: ${segment || '<empty>'}`);
    }
  }
}

function lastSegment(path: readonly string[]): string {
  const segment = path[path.length - 1];
  if (!segment) throw new ConfigPatchPathError('Config patch path is empty');
  return segment;
}

function pointer(path: readonly string[]): string {
  if (path.length === 0) return '/';
  return `/${path.map((segment) => segment.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
}
