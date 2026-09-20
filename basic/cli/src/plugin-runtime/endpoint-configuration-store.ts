import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  type AddConfiguredEndpointRequest,
  type ConfiguredEndpointEntry,
  type EndpointConfigurationStore,
  type EndpointConfigurationMutation,
  type RemoveConfiguredEndpointResult,
} from '@zhin.js/adapter';
import type {
  ConfigDocumentPort,
  ConfigPatch,
  PreparedConfigDocument,
  RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';

interface FileSnapshot {
  readonly exists: boolean;
  readonly content: string;
  readonly mode?: number;
}

/**
 * Composition-root endpoint persistence over the canonical Root config port.
 *
 * Config format, optimistic concurrency and atomic replacement belong to the
 * injected ConfigDocumentPort. This class owns endpoint structure and the
 * cross-file ordering needed for secret references: write `.env` first, commit
 * the prepared Root config second, then publish values to process.env.
 */
export class ProjectEndpointConfigurationStore implements EndpointConfigurationStore {
  readonly #projectRoot: string;
  readonly #configFile: string;
  readonly #document: ConfigDocumentPort;
  readonly #environment: NodeJS.ProcessEnv;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(options: {
    readonly projectRoot: string;
    readonly configFile: string;
    readonly document: ConfigDocumentPort;
    readonly environment?: NodeJS.ProcessEnv;
  }) {
    this.#projectRoot = resolve(options.projectRoot);
    this.#configFile = resolve(options.configFile);
    this.#document = options.document;
    this.#environment = options.environment ?? process.env;
  }

  list(adapterKey: string): Promise<readonly ConfiguredEndpointEntry[]> {
    return this.#afterMutations(async () => {
      const snapshot = await this.#document.read();
      return readConfiguredEndpoints(snapshot.document, adapterKey);
    });
  }

  add(request: AddConfiguredEndpointRequest): Promise<EndpointConfigurationMutation> {
    return this.#serialize(async () => {
      const current = await this.#document.read();
      const endpoints = readConfiguredEndpoints(current.document, request.adapterKey);
      if (endpoints.some((entry) => entry.id === request.entry.id)) {
        throw new Error(
          `配置中已存在 ${request.adapterKey} endpoint「${request.entry.id}」，`
          + `可先 ${request.adapterKey} endpoint remove ${request.entry.id} 再重新添加`,
        );
      }
      const prepared = await this.#document.prepare(current, [
        endpointListPatch(request.adapterKey, [...endpoints, request.entry]),
      ]);
      await this.#commitWithEnvironment(prepared, request.environment);
      return Object.freeze({ filePath: this.#configFile });
    });
  }

  remove(adapterKey: string, endpointId: string): Promise<RemoveConfiguredEndpointResult> {
    return this.#serialize(async () => {
      const current = await this.#document.read();
      const endpoints = readConfiguredEndpoints(current.document, adapterKey);
      const next = endpoints.filter((entry) => entry.id !== endpointId);
      if (next.length === endpoints.length) {
        return Object.freeze({ removed: false, filePath: this.#configFile });
      }
      const prepared = await this.#document.prepare(current, [
        endpointListPatch(adapterKey, next),
      ]);
      await prepared.commit();
      return Object.freeze({ removed: true, filePath: this.#configFile });
    });
  }

  async #commitWithEnvironment(
    prepared: PreparedConfigDocument,
    environment: Readonly<Record<string, string>>,
  ): Promise<void> {
    const entries = Object.entries(environment);
    if (entries.length === 0) {
      await prepared.commit();
      return;
    }

    const envPath = join(this.#projectRoot, '.env');
    const previous = await readFileSnapshot(envPath);
    let content = previous.content;
    for (const [key, value] of entries) content = upsertEnvLine(content, key, value);
    await atomicReplace(envPath, content, previous.mode);
    try {
      await prepared.commit();
    } catch (error) {
      try {
        await restoreFile(envPath, previous);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Root config commit failed and .env rollback also failed: ${this.#configFile}`,
          { cause: rollbackError },
        );
      }
      throw error;
    }
    for (const [key, value] of entries) this.#environment[key] = value;
  }

  #afterMutations<T>(operation: () => Promise<T>): Promise<T> {
    return this.#mutationTail.then(operation);
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutationTail.then(operation);
    this.#mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

function endpointListPatch(
  adapterKey: string,
  endpoints: readonly ConfiguredEndpointEntry[],
): ConfigPatch {
  return Object.freeze({
    op: 'set',
    path: Object.freeze(['plugins', adapterKey, 'endpoints']),
    value: endpoints,
  });
}

function readConfiguredEndpoints(
  document: RuntimeConfigDocument,
  adapterKey: string,
): readonly ConfiguredEndpointEntry[] {
  const plugins = optionalObject(document.plugins, 'plugins');
  if (!plugins) return Object.freeze([]);
  const adapter = optionalObject(plugins[adapterKey], `plugins.${adapterKey}`);
  if (!adapter) return Object.freeze([]);
  const endpoints = adapter.endpoints;
  if (endpoints === undefined) return Object.freeze([]);
  if (!Array.isArray(endpoints)) {
    throw new Error(`配置的 plugins.${adapterKey}.endpoints 必须是数组`);
  }
  return Object.freeze(endpoints.map((value, index) => {
    const entry = requiredObject(value, `plugins.${adapterKey}.endpoints[${index}]`);
    if (typeof entry.id !== 'string' || entry.id.trim() === '') {
      throw new Error(`配置的 plugins.${adapterKey}.endpoints[${index}].id 必须是非空字符串`);
    }
    return Object.freeze({ ...entry }) as ConfiguredEndpointEntry;
  }));
}

function optionalObject(
  value: unknown,
  pathLabel: string,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  return requiredObject(value, pathLabel);
}

function requiredObject(value: unknown, pathLabel: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`配置的 ${pathLabel} 必须是对象映射，请运行 zhin migrate 后再试`);
  }
  return value as Readonly<Record<string, unknown>>;
}

async function readFileSnapshot(filePath: string): Promise<FileSnapshot> {
  try {
    const content = await readFile(filePath, 'utf8');
    return Object.freeze({ exists: true, content, mode: (await stat(filePath)).mode });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return Object.freeze({ exists: false, content: '' });
    }
    throw error;
  }
}

async function restoreFile(filePath: string, snapshot: FileSnapshot): Promise<void> {
  if (snapshot.exists) await atomicReplace(filePath, snapshot.content, snapshot.mode);
  else await rm(filePath, { force: true });
}

async function atomicReplace(filePath: string, content: string, mode?: number): Promise<void> {
  const temporary = resolve(
    dirname(filePath),
    `${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, content, mode === undefined ? undefined : { mode });
    await rename(temporary, filePath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function upsertEnvLine(content: string, key: string, value: string): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${escapedKey}\\s*=.*$`, 'mu');
  if (pattern.test(content)) return content.replace(pattern, line);
  const trimmed = content.replace(/\s*$/u, '');
  return trimmed ? `${trimmed}\n${line}\n` : `${line}\n`;
}
