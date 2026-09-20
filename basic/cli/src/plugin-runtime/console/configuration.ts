import type { ConfigFileDocument } from '@zhin.js/config-file';
import type { ConsoleConfigSource } from '@zhin.js/console-protocol';
import type { PluginConfigValidation } from '@zhin.js/host-http';
import {
  readPluginConfigurationMap,
  type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';
import { HOST_CONFIG_KEYS } from '@zhin.js/runtime';
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
  }) {
    this.#projectRoot = options.projectRoot;
    this.#document = options.document;
    this.#schemas = new PluginSchemaCatalog(options.projectRoot);
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
  ): Promise<{ readonly revision: string }> {
    return this.#serialize(async () => {
      const prepared = await this.#document.prepareReplacement(expectedRevision, source);
      const committed = await prepared.commit();
      return Object.freeze({ revision: committed.revision });
    });
  }

  setKey(pluginName: string, data: unknown): Promise<{ restartRequired: boolean }> {
    return this.#serialize(async () => {
      const current = await this.#document.read();
      const prepared = await this.#document.prepare(current, [
        configKeyPatch(current.document, pluginName, data),
      ]);
      await prepared.commit();
      return Object.freeze({ restartRequired: true });
    });
  }

  removeKey(pluginName: string): Promise<{ restartRequired: boolean }> {
    return this.#serialize(async () => {
      const current = await this.#document.read();
      const prepared = await this.#document.prepare(current, [
        configKeyRemovePatch(current.document, pluginName),
      ]);
      await prepared.commit();
      return Object.freeze({ restartRequired: true });
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
    const schema = await this.#schemas.read(pluginName);
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
    validateValue(schema, data, '$', errors, missingEnv, envNames);
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

function validateValue(
  schema: unknown,
  value: unknown,
  path: string,
  errors: Array<{ path: string; message: string }>,
  missingEnv: Set<string>,
  envNames: ReadonlySet<string>,
): void {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;
  const definition = schema as Record<string, unknown>;
  if (typeof value === 'string') {
    for (const name of value.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/gu)) {
      if (!envNames.has(name[1]!)) missingEnv.add(name[1]!);
    }
  }
  if (definition.required === true && (value === undefined || value === null || value === '')) {
    errors.push({ path, message: '必填项不能为空' });
    return;
  }
  if (value == null) return;
  const type = typeof definition.type === 'string' ? definition.type : undefined;
  const validType = type === 'number' || type === 'integer'
    ? typeof value === 'number' && Number.isFinite(value) && (type !== 'integer' || Number.isInteger(value))
    : type === 'boolean' ? typeof value === 'boolean'
      : type === 'string' ? typeof value === 'string'
        : type === 'list' ? Array.isArray(value)
          : type === 'object' ? typeof value === 'object' && !Array.isArray(value)
            : true;
  if (!validType) errors.push({ path, message: `类型应为 ${type}` });
  if (Array.isArray(definition.options) && !definition.options.some((option) => (
    option && typeof option === 'object' && 'value' in option
      ? (option as { value?: unknown }).value === value
      : option === value
  ))) errors.push({ path, message: '值不在允许范围内' });
  if (type === 'object' && definition.object && typeof definition.object === 'object') {
    const object = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(definition.object as Record<string, unknown>)) {
      validateValue(child, object[key], `${path}.${key}`, errors, missingEnv, envNames);
    }
  }
  if (type === 'list' && definition.inner) {
    for (const [index, item] of (value as unknown[]).entries()) {
      validateValue(definition.inner, item, `${path}[${index}]`, errors, missingEnv, envNames);
    }
  }
}

export { configKeyPatch, configKeyRemovePatch, flattenConfigDocument } from './configuration-projection.js';
