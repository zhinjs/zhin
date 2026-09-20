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

interface ConfigFileState {
  readonly exists: boolean;
  readonly source: string;
  readonly mode?: number;
}

const EMPTY_CONFIG_SOURCE = '{}\n';

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
    const state = await readConfigFileState(this.file);
    return createConfigDocumentSnapshot(
      this.parseSource(state.exists ? state.source : EMPTY_CONFIG_SOURCE),
      state,
    );
  }

  async prepare(
    current: ConfigDocumentSnapshot,
    patches: readonly ConfigPatch[],
  ): Promise<PreparedConfigDocument> {
    const state = await readConfigFileState(this.file);
    assertRevision(this.file, state, current.revision);
    const source = state.exists ? state.source : EMPTY_CONFIG_SOURCE;
    const candidate = this.prepareSource(source, patches);
    return new PreparedConfigFileDocument(
      this.file,
      state,
      current.revision,
      candidate.source,
      candidate.document,
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
  readonly #previous: ConfigFileState;
  readonly #previousRevision: string;
  readonly #candidateSource: string;
  readonly #candidateRevision: string;
  #state: 'prepared' | 'committed' | 'rolled-back' = 'prepared';
  #committedSnapshot?: ConfigDocumentSnapshot;

  constructor(
    file: string,
    previous: ConfigFileState,
    previousRevision: string,
    candidateSource: string,
    document: RuntimeConfigDocument,
  ) {
    this.#file = file;
    this.#previous = previous;
    this.#previousRevision = previousRevision;
    this.#candidateSource = candidateSource;
    this.document = document;
    this.#candidateRevision = revision({ exists: true, source: candidateSource });
  }

  async commit(): Promise<ConfigDocumentSnapshot> {
    if (this.#state === 'committed') return requireSnapshot(this.#committedSnapshot);
    if (this.#state === 'rolled-back') {
      throw new ConfigFileDocumentError('A rolled-back config transaction cannot commit');
    }
    const state = await readConfigFileState(this.#file);
    assertRevision(this.#file, state, this.#previousRevision);
    const committed = Object.freeze({
      document: this.document,
      revision: this.#candidateRevision,
    });
    await atomicReplace(this.#file, this.#candidateSource, this.#previous.mode);
    this.#committedSnapshot = committed;
    this.#state = 'committed';
    return committed;
  }

  async rollback(): Promise<void> {
    if (this.#state !== 'committed') {
      if (this.#state === 'prepared') this.#state = 'rolled-back';
      return;
    }
    const state = await readConfigFileState(this.#file);
    assertRevision(this.#file, state, this.#candidateRevision);
    if (this.#previous.exists) {
      await atomicReplace(this.#file, this.#previous.source, this.#previous.mode);
    } else {
      await rm(this.#file);
    }
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
  state: ConfigFileState,
): ConfigDocumentSnapshot {
  return Object.freeze({ document, revision: revision(state) });
}

function revision(state: Pick<ConfigFileState, 'exists' | 'source'>): string {
  return createHash('sha256')
    .update(state.exists ? 'present\0' : 'absent\0')
    .update(state.source)
    .digest('hex');
}

function assertRevision(file: string, state: ConfigFileState, expected: string): void {
  if (revision(state) !== expected) throw new ConfigDocumentConflictError(file);
}

async function readConfigFileState(file: string): Promise<ConfigFileState> {
  try {
    const source = await readFile(file, 'utf8');
    return Object.freeze({ exists: true, source, mode: (await stat(file)).mode });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return Object.freeze({ exists: false, source: '' });
    }
    throw error;
  }
}

async function atomicReplace(file: string, source: string, mode?: number): Promise<void> {
  const temporary = `${basename(file)}.${process.pid}.${randomUUID()}.tmp`;
  const target = resolve(dirname(file), temporary);
  try {
    await writeFile(target, source, mode === undefined ? undefined : { mode });
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
