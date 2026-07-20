import { readFile } from 'node:fs/promises';
import type { ClientModuleRequest } from '@zhin.js/feature-kit';
import type {
  ClientArtifactManifest,
  ClientArtifactRecord,
  ClientModuleLoader,
} from './types.js';

export class ManifestClientModuleLoader implements ClientModuleLoader {
  readonly #entries: ReadonlyMap<string, Readonly<ClientArtifactRecord>>;

  constructor(manifest: ClientArtifactManifest) {
    if (manifest.protocol !== 1 || !Array.isArray(manifest.entries)) {
      throw new TypeError('Unsupported client artifact manifest');
    }
    const entries = new Map<string, Readonly<ClientArtifactRecord>>();
    for (const candidate of manifest.entries) {
      const entry = validateEntry(candidate);
      const key = artifactKey(entry);
      if (entries.has(key)) throw new Error(`Duplicate client artifact: ${key}`);
      entries.set(key, Object.freeze({ ...entry }));
    }
    this.#entries = entries;
  }

  static async fromFile(path: string): Promise<ManifestClientModuleLoader> {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as ClientArtifactManifest;
    return new ManifestClientModuleLoader(parsed);
  }

  async load<T = unknown>(_source: string, request: ClientModuleRequest): Promise<T> {
    const entry = this.#entries.get(artifactKey(request));
    if (!entry) throw new Error(`Missing client artifact for ${request.feature}:${request.localName}`);
    return Object.freeze({
      module: entry.module,
      hash: entry.hash,
      metadata: entry.metadata,
    }) as T;
  }
}

function artifactKey(request: ClientModuleRequest): string {
  return `${request.owner}\0${request.feature}\0${request.localName}`;
}

function validateEntry(value: unknown): ClientArtifactRecord {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid client artifact entry');
  const entry = value as Partial<ClientArtifactRecord>;
  for (const field of ['source', 'owner', 'feature', 'localName', 'module', 'hash'] as const) {
    if (typeof entry[field] !== 'string' || !entry[field]) {
      throw new TypeError(`Invalid client artifact ${field}`);
    }
  }
  return entry as ClientArtifactRecord;
}
