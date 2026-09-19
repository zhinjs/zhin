import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type {
  ConfigDocumentPort,
  ConfigDocumentSnapshot,
  ConfigPatch,
  PreparedConfigDocument,
  RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';

export type ConfigFileFormat = 'YAML' | 'JSON';

export interface PreparedConfigFileSource {
  readonly document: RuntimeConfigDocument;
  readonly source: string;
}

export class ConfigFileDocumentError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigFileDocumentError';
  }
}

export class ConfigDocumentParseError extends ConfigFileDocumentError {
  constructor(
    readonly file: string,
    readonly format: ConfigFileFormat,
    readonly issues: readonly string[],
  ) {
    super(`Cannot parse ${format} config ${file}:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'ConfigDocumentParseError';
  }
}

export class ConfigDocumentConflictError extends ConfigFileDocumentError {
  constructor(readonly file: string) {
    super(`Config file changed since it was read: ${file}`);
    this.name = 'ConfigDocumentConflictError';
  }
}

/** Owns the format-independent transaction and optimistic concurrency lifecycle. */
export abstract class ConfigFileDocument implements ConfigDocumentPort {
  readonly file: string;
  abstract readonly format: ConfigFileFormat;

  constructor(file: string) {
    this.file = resolve(file);
  }

  async read(): Promise<ConfigDocumentSnapshot> {
    const source = await readFile(this.file, 'utf8');
    return createConfigDocumentSnapshot(this.parseSource(source), source);
  }

  async prepare(
    current: ConfigDocumentSnapshot,
    patches: readonly ConfigPatch[],
  ): Promise<PreparedConfigDocument> {
    const source = await readFile(this.file, 'utf8');
    assertRevision(this.file, source, current.revision);
    const candidate = this.prepareSource(source, patches);
    const fileMode = (await stat(this.file)).mode;
    return new PreparedConfigFileDocument(
      this.file,
      source,
      current.revision,
      candidate.source,
      candidate.document,
      fileMode,
    );
  }

  protected abstract parseSource(source: string): RuntimeConfigDocument;
  protected abstract prepareSource(
    source: string,
    patches: readonly ConfigPatch[],
  ): PreparedConfigFileSource;
}

class PreparedConfigFileDocument implements PreparedConfigDocument {
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
      throw new ConfigFileDocumentError('A rolled-back config transaction cannot commit');
    }
    const source = await readFile(this.#file, 'utf8');
    assertRevision(this.#file, source, this.#previousRevision);
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

export function requireConfigObject(
  file: string,
  format: ConfigFileFormat,
  value: unknown,
): RuntimeConfigDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigDocumentParseError(file, format, ['The document root must be an object']);
  }
  return Object.freeze(value as Record<string, unknown>);
}

function createConfigDocumentSnapshot(
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
  if (!value) throw new Error('Committed config transaction has no snapshot');
  return value;
}
