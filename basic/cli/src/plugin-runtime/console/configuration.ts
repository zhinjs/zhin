import type { ConfigFileDocument } from '@zhin.js/config-file';
import { isDeepStrictEqual } from 'node:util';
import type { ConsoleConfigSource } from '@zhin.js/console-protocol';
import type { PluginConfigValidation } from '@zhin.js/host-http';
import {
  readPluginConfigurationMap,
  type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';
import { HOST_CONFIG_KEYS, validatePluginConfigSchema } from '@zhin.js/runtime';
import { readPluginPackageMap } from './plugin-package-map.js';
import { configKeyPatch, configKeyRemovePatch, flattenConfigDocument } from './configuration-projection.js';
import { readEnvFile, writeEnvFile } from './environment-files.js';
import { PluginSchemaCatalog } from './plugin-schema-catalog.js';

/** Owns one project's Console configuration projection over the Root config authority. */
export class ConsoleConfigurationStore {
  readonly #projectRoot: string;
  readonly #document: ConfigFileDocument;
  readonly #schemas: PluginSchemaCatalog;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(options: {
    readonly projectRoot: string;
    readonly document: ConfigFileDocument;
    readonly configDeclarations?: () => ReadonlyMap<string, Readonly<Record<string, unknown>>> | Promise<ReadonlyMap<string, Readonly<Record<string, unknown>>>>;
  }) {
    this.#projectRoot = options.projectRoot;
    this.#document = options.document;
    this.#schemas = new PluginSchemaCatalog(options.projectRoot, options.configDeclarations);
  }

  readSource(): Promise<ConsoleConfigSource> {
    return this.#afterMutations(async () => {
      const snapshot = await this.#document.readSource();
      return Object.freeze({
        source: snapshot.source,
        format: snapshot.format === 'YAML' ? 'yaml' : 'json',
        revision: snapshot.revision,
        configKeys: await this.#listKeys(snapshot.document),
      });
    });
  }

  readDocument(): Promise<Record<string, unknown>> {
    return this.#afterMutations(async () => {
      const snapshot = await this.#document.read();
      return flattenConfigDocument(snapshot.document);
    });
  }

  replaceSource(
    source: string,
    expectedRevision: string,
  ): Promise<{ readonly revision: string; readonly restartRequired: boolean }> {
    return this.#serialize(async () => {
      const current = await this.#document.read();
      const prepared = await this.#document.prepareReplacement(expectedRevision, source);
      const committed = await prepared.commit();
      return Object.freeze({
        revision: committed.revision,
        restartRequired: HOST_CONFIG_KEYS.some((key) => !isDeepStrictEqual(
          current.document[key],
          prepared.document[key],
        )),
      });
    });
  }

  setKey(pluginName: string, data: unknown): Promise<{ restartRequired: boolean }> {
    return this.#serialize(async () => {
      const current = await this.#document.read();
      const prepared = await this.#document.prepare(current, [
        configKeyPatch(current.document, pluginName, data),
      ]);
      await prepared.commit();
      return Object.freeze({ restartRequired: HOST_CONFIG_KEYS.includes(pluginName) });
    });
  }

  removeKey(pluginName: string): Promise<{ restartRequired: boolean }> {
    return this.#serialize(async () => {
      const current = await this.#document.read();
      const prepared = await this.#document.prepare(current, [
        configKeyRemovePatch(current.document, pluginName),
      ]);
      await prepared.commit();
      return Object.freeze({ restartRequired: HOST_CONFIG_KEYS.includes(pluginName) });
    });
  }

  readEnvironmentFile(filename: string): Promise<string> {
    return readEnvFile(this.#projectRoot, filename);
  }

  writeEnvironmentFile(filename: string, content: string): Promise<void> {
    return writeEnvFile(this.#projectRoot, filename, content);
  }

  readSchema(pluginName?: string): Promise<unknown> {
    return this.#schemas.read(pluginName);
  }

  async validatePluginConfig(pluginName: string, data: unknown): Promise<PluginConfigValidation> {
    const schema = await this.#schemas.readJson(pluginName);
    const errors: Array<{ path: string; message: string }> = [];
    const missingEnv = new Set<string>();
    const envNames = new Set(Object.keys(process.env));
    for (const file of ['.env', '.env.development', '.env.production']) {
      const source = await readEnvFile(this.#projectRoot, file);
      for (const line of source.split(/\r?\n/u)) {
        const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=/u.exec(line);
        if (match) envNames.add(match[1]!);
      }
    }
    if (schema) {
      for (const issue of validatePluginConfigSchema(schema, data)) {
        const location = issue.instancePath.replace(/^\/candidate/u, '').split('/').slice(1)
          .map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'));
        errors.push({
          path: `$${location.map(key => `.${key}`).join('')}`,
          message: issue.keyword === 'type'
            ? `类型应为 ${issue.params.type === 'array' ? 'list' : String(issue.params.type)}`
            : issue.message ?? issue.keyword,
        });
      }
    }
    collectEnvironmentReferences(data, missingEnv, envNames);
    return Object.freeze({
      valid: errors.length === 0,
      errors: Object.freeze(errors),
      missingEnv: Object.freeze([...missingEnv].sort()),
    });
  }

  async readAllSchemas(): Promise<Record<string, unknown>> {
    return this.#schemas.readAll(await this.listKeys());
  }

  listKeys(): Promise<string[]> {
    return this.#afterMutations(async () => {
      const { document } = await this.#document.read();
      return this.#listKeys(document);
    });
  }

  async #listKeys(document: RuntimeConfigDocument): Promise<string[]> {
    const keys = new Set<string>(Object.keys(readPluginConfigurationMap(document)));
    for (const key of HOST_CONFIG_KEYS) {
      if (Object.prototype.hasOwnProperty.call(document, key)) keys.add(key);
    }
    for (const key of (await readPluginPackageMap(this.#projectRoot)).keys()) keys.add(key);
    return [...keys].sort((left, right) => left.localeCompare(right));
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

function collectEnvironmentReferences(
  value: unknown,
  missingEnv: Set<string>,
  envNames: ReadonlySet<string>,
): void {
  if (typeof value === 'string') {
    for (const name of value.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/gu)) {
      if (!envNames.has(name[1]!)) missingEnv.add(name[1]!);
    }
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectEnvironmentReferences(item, missingEnv, envNames);
  }
}

export { configKeyPatch, configKeyRemovePatch, flattenConfigDocument } from './configuration-projection.js';
