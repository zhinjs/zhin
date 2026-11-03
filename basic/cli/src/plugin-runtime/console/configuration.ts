import { ConfigDocumentConflictError, type ConfigFileDocument } from '@zhin.js/config-file';
import { isDeepStrictEqual } from 'node:util';
import type { ConsoleConfigApplication, ConsoleConfigApplicationStatus, ConsoleConfigApplyResult, ConsoleConfigPatchRequest, ConsoleConfigPatchResult, ConsoleConfigSource } from '@zhin.js/console-protocol';
import type { PluginConfigValidation } from '@zhin.js/host-http';
import {
  applyConfigPatches,
  readPluginConfigurationMap,
  rootPluginId,
  type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';
import { ConfigValidationError, ConfigurationSupersededError, HOST_CONFIG_KEYS, readApplicationPluginDeclaration, parsePluginConfigSchema, createEnvStore, type EnvStore } from '@zhin.js/runtime';
import { loadRuntimeEnvironmentLayers } from '../start/environment.js';
import { readPluginPackageMap } from './plugin-package-map.js';
import { assertUnambiguousConfigKey, configKeyPatch, configKeyRemovePatch, flattenConfigDocument } from './configuration-projection.js';
import { readEnvFile, writeEnvFile } from './environment-files.js';
import { PluginSchemaCatalog } from './plugin-schema-catalog.js';
import {
  assertPatchesInScope,
  normalizeConfigPatchOperations,
  readDeclaredPatchPaths,
  readPath,
  resolvePatchScope,
} from './configuration-patch.js';

/** Owns one project's Console configuration projection over the Root config authority. */
export class ConsoleConfigurationStore {
  readonly #projectRoot: string;
  readonly #document: ConfigFileDocument;
  readonly #schemas: PluginSchemaCatalog;
  readonly #environmentName: () => string;
  readonly #environmentForPlugin?: (pluginName: string) => Pick<EnvStore, 'has'> | undefined;
  readonly #applyConfiguration?: (expectedRevision?: string) => Promise<ConsoleConfigApplication>;
  readonly #readApplication?: () => ConsoleConfigApplication | undefined;
  readonly #validateConfiguration?: (document: RuntimeConfigDocument) => Promise<void>;
  #applicationError?: 'unconfirmed' | 'superseded' | 'invalid';
  #applicationErrorAtOperationId?: string;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(options: {
    readonly projectRoot: string;
    readonly document: ConfigFileDocument;
    readonly configDeclarations?: () => ReadonlyMap<string, Readonly<Record<string, unknown>>> | Promise<ReadonlyMap<string, Readonly<Record<string, unknown>>>>;
    readonly environmentName?: string | (() => string);
    readonly environmentForPlugin?: (pluginName: string) => Pick<EnvStore, 'has'> | undefined;
    readonly applyConfiguration?: (expectedRevision?: string) => Promise<ConsoleConfigApplication>;
    readonly readApplication?: () => ConsoleConfigApplication | undefined;
    readonly validateConfiguration?: (document: RuntimeConfigDocument) => Promise<void>;
  }) {
    this.#projectRoot = options.projectRoot;
    this.#document = options.document;
    this.#schemas = new PluginSchemaCatalog(options.projectRoot, options.configDeclarations);
    const environmentName = options.environmentName;
    this.#environmentName = typeof environmentName === 'function' ? environmentName : () => environmentName ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development');
    this.#environmentForPlugin = options.environmentForPlugin;
    this.#applyConfiguration = options.applyConfiguration;
    this.#readApplication = options.readApplication;
    this.#validateConfiguration = options.validateConfiguration;
  }

  readSource(): Promise<ConsoleConfigSource> {
    return this.#afterMutations(async () => {
      const snapshot = await this.#document.readSource();
      const configKeys = await this.#listKeys(snapshot.document);
      const declaredPlugins = await readPluginPackageMap(this.#projectRoot, snapshot.document);
      const pluginConfigs = readPluginConfigurationMap(snapshot.document);
      const application = this.#readApplication?.();
      if (application && application.operationId !== this.#applicationErrorAtOperationId) this.#applicationError = undefined;
      return Object.freeze({
        source: snapshot.source,
        format: snapshot.format === 'YAML' ? 'yaml' : 'json',
        revision: snapshot.revision,
        ...(application ? { application } : {}),
        ...(this.#applicationError ? { applicationError: this.#applicationError } : {}),
        configKeys,
        configPaths: Object.freeze(Object.fromEntries(configKeys.filter(key =>
          !HOST_CONFIG_KEYS.includes(key as typeof HOST_CONFIG_KEYS[number])
          || (!declaredPlugins.has(key)
            && !Object.prototype.hasOwnProperty.call(pluginConfigs, key))).map(key =>
          [key, configKeyPatch(snapshot.document, key, undefined).path]))),
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
  ): Promise<{ readonly revision: string; readonly restartRequired: boolean } & ConsoleConfigApplicationStatus> {
    return this.#serialize(async () => {
      const current = await this.#document.read();
      const prepared = await this.#document.prepareReplacement(expectedRevision, source);
      readApplicationPluginDeclaration(prepared.document);
      await this.#validatePrepared(prepared);
      const committed = await prepared.commit();
      return Object.freeze({
        revision: committed.revision,
        ...await this.#applySaved(HOST_CONFIG_KEYS.some((key) => !isDeepStrictEqual(
          current.document[key],
          prepared.document[key],
        )), committed.revision),
      });
    });
  }

  setKey(pluginName: string, data: unknown): Promise<{ restartRequired: boolean } & ConsoleConfigApplicationStatus> {
    return this.#serialize(async () => {
      const current = await this.#document.read();
      await this.#assertUnambiguousKey(current.document, pluginName);
      const prepared = await this.#document.prepare(current, [
        configKeyPatch(current.document, pluginName, data),
      ]);
      readApplicationPluginDeclaration(prepared.document);
      await this.#validatePrepared(prepared);
      const committed = await prepared.commit();
      return this.#applySaved(HOST_CONFIG_KEYS.includes(pluginName), committed.revision);
    });
  }

  removeKey(pluginName: string): Promise<{ restartRequired: boolean } & ConsoleConfigApplicationStatus> {
    return this.#serialize(async () => {
      const current = await this.#document.read();
      await this.#assertUnambiguousKey(current.document, pluginName);
      const prepared = await this.#document.prepare(current, [
        configKeyRemovePatch(current.document, pluginName),
      ]);
      readApplicationPluginDeclaration(prepared.document);
      await this.#validatePrepared(prepared);
      const committed = await prepared.commit();
      return this.#applySaved(HOST_CONFIG_KEYS.includes(pluginName), committed.revision);
    });
  }

  /**
   * Scoped, revision-checked path writes (`config:patch`). Paths outside the caller's
   * allowlist are rejected before reading values; a stale revision returns the latest
   * values instead of overwriting; every touched section is validated by its schema.
   */
  patch(request: ConsoleConfigPatchRequest): Promise<ConsoleConfigPatchResult> {
    const instanceKey = request.instanceKey;
    return this.#serialize(async () => {
      const patches = normalizeConfigPatchOperations(request.patches);
      const current = await this.#document.read();
      const declared = instanceKey === undefined
        ? []
        : readDeclaredPatchPaths(await this.#ownSchema(current.document, instanceKey), instanceKey);
      const allowed = resolvePatchScope(current.document, instanceKey, declared);
      assertPatchesInScope(patches, allowed, instanceKey === undefined ? 'Host 白名单' : `插件 ${instanceKey}`);
      const paths = Object.freeze(patches.map(patch => patch.path));
      const conflict = (snapshot: typeof current): ConsoleConfigPatchResult => Object.freeze({
        status: 'conflict',
        revision: snapshot.revision,
        current: Object.freeze(paths.map(path => Object.freeze({ path, value: readPath(snapshot.document, path) }))),
        message: '配置已被其他地方修改，未保存。请查看最新值后重试。',
      });
      if (current.revision !== request.expectedRevision) return conflict(current);
      const candidate = applyConfigPatches(current.document, patches);
      const sections = [...new Set(patches.map(patch => patch.path[0]!))];
      const errors: Array<{ path: string; message: string }> = [];
      const missingEnv = new Set<string>();
      for (const section of sections) {
        if (candidate[section] === undefined) continue;
        const validation = await this.validatePluginConfig(section, candidate[section], current.document);
        for (const error of validation.errors) errors.push({ path: `$.${section}${error.path.slice(1)}`, message: error.message });
        for (const name of validation.missingEnv) missingEnv.add(name);
      }
      if (errors.length > 0) {
        return Object.freeze({
          status: 'invalid',
          revision: current.revision,
          errors: Object.freeze(errors),
          missingEnv: Object.freeze([...missingEnv].sort()),
          message: '配置校验失败，未保存',
        });
      }
      let committed;
      try {
        const prepared = await this.#document.prepare(current, patches);
        readApplicationPluginDeclaration(prepared.document);
        await this.#validatePrepared(prepared);
        committed = await prepared.commit();
      } catch (error) {
        if (error instanceof ConfigDocumentConflictError) return conflict(await this.#document.read());
        throw error;
      }
      const applied = await this.#applySaved(sections.some(section => HOST_CONFIG_KEYS.includes(section)), committed.revision);
      return Object.freeze({
        status: 'saved',
        revision: committed.revision,
        ...applied,
        paths,
        missingEnv: Object.freeze([...missingEnv].sort()),
        message: applied.applicationError === 'superseded' ? '配置已保存，但该次生效申请已被替代'
          : applied.applicationError === 'invalid' ? '配置已保存，但配置校验失败，未生效'
          : applied.applicationError ? '配置已保存，生效结果未确认' : applied.restartRequired
          ? (applied.application ? '配置已保存，部分配置待重启生效' : '配置已保存，需重启进程才能生效') : applied.application
            ? '配置已保存，请查看各项生效结果' : '配置已保存',
      });
    });
  }

  async #validatePrepared(prepared: import('@zhin.js/plugin-runtime').PreparedConfigDocument): Promise<void> {
    try { await this.#validateConfiguration?.(prepared.document); }
    catch (error) {
      const failures: unknown[] = [error];
      try { await prepared.rollback(); }
      catch (rollback) { failures.push(rollback); }
      if (failures.length > 1) throw new AggregateError(failures, 'Configuration validation and preparation cleanup failed', { cause: error });
      throw error;
    }
  }

  apply(expectedRevision: string): Promise<ConsoleConfigApplyResult> {
    return this.#serialize(async () => {
      const current = await this.#document.read();
      if (current.revision !== expectedRevision) return Object.freeze({ status: 'conflict', revision: current.revision,
        message: '配置已被其他地方修改，请重新读取后申请应用' });
      if (!this.#applyConfiguration) return Object.freeze({ status: 'unconfirmed', message: '当前 Host 未提供配置应用能力' });
      try {
        const application = await this.#applyConfiguration(expectedRevision);
        this.#applicationError = undefined;
        return Object.freeze({ status: 'applied', application });
      } catch (error) {
        if (error instanceof ConfigurationSupersededError) return Object.freeze({ status: 'conflict',
          revision: (await this.#document.read()).revision, message: '配置已被较新修订替代，请重新读取' });
        if (error instanceof ConfigValidationError) return Object.freeze({ status: 'invalid', message: '配置校验失败，未应用' });
        this.#applicationError = 'unconfirmed';
        this.#applicationErrorAtOperationId = this.#readApplication?.()?.operationId;
        return Object.freeze({ status: 'unconfirmed', message: '配置生效结果未确认，请读取运行状态核对' });
      }
    });
  }

  async #applySaved(legacyRestartRequired: boolean, expectedRevision: string): Promise<{ readonly restartRequired: boolean } & ConsoleConfigApplicationStatus> {
    if (!this.#applyConfiguration) return Object.freeze({ restartRequired: legacyRestartRequired });
    try {
      const application = await this.#applyConfiguration(expectedRevision);
      this.#applicationError = undefined;
      return Object.freeze({ application,
        restartRequired: application.groups.some(group => group.status === 'restart-pending') });
    } catch (error) {
      // Saving has already succeeded. An exception cannot prove whether handoff
      // published a generation; do not turn it into a misleading save failure.
      this.#applicationError = error instanceof ConfigurationSupersededError ? 'superseded'
        : error instanceof ConfigValidationError ? 'invalid' : 'unconfirmed';
      this.#applicationErrorAtOperationId = this.#readApplication?.()?.operationId;
      return Object.freeze({ restartRequired: false, applicationError: this.#applicationError });
    }
  }

  async #ownSchema(document: RuntimeConfigDocument, instanceKey: string): Promise<Readonly<Record<string, unknown>> | null> {
    if (HOST_CONFIG_KEYS.includes(instanceKey)) return null;
    try {
      assertUnambiguousConfigKey(document, instanceKey);
    } catch {
      return null;
    }
    return this.#schemas.readJson(instanceKey, document);
  }

  readEnvironmentFile(filename: string): Promise<string> {
    return readEnvFile(this.#projectRoot, filename);
  }

  writeEnvironmentFile(filename: string, content: string): Promise<void> {
    return writeEnvFile(this.#projectRoot, filename, content);
  }

  async readSchema(pluginName?: string): Promise<unknown> {
    const {document} = await this.#document.read();
    if (pluginName) await this.#assertUnambiguousKey(document, pluginName);
    return this.#schemas.read(pluginName, document);
  }

  async validatePluginConfig(pluginName: string, data: unknown, capturedDocument?: RuntimeConfigDocument): Promise<PluginConfigValidation> {
    const document = capturedDocument ?? (await this.#document.read()).document;
    await this.#assertUnambiguousKey(document, pluginName);
    const schema = await this.#schemas.readJson(pluginName, document);
    const errors: Array<{ path: string; message: string }> = [];
    const missingEnv = new Set<string>();
    const candidate = schema ? parsePluginConfigSchema(schema, data) : { value: data, errors: [] };
    const environmentName = this.#environmentName();
    const environment = this.#environmentForPlugin?.(pluginName) ?? createEnvStore(rootPluginId(),
      { name: environmentName, mode: environmentName === 'production' ? 'production' : 'development', platform: 'node' },
      await loadRuntimeEnvironmentLayers(this.#projectRoot, environmentName));
    if (schema) {
      for (const issue of candidate.errors) {
        const location = issue.instancePath.replace(/^\/candidate/u, '').split('/').slice(1)
          .map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'));
        if (issue.keyword === 'required' && typeof issue.params.missingProperty === 'string') {
          location.push(issue.params.missingProperty);
        }
        errors.push({
          path: `$${location.map(key => `.${key}`).join('')}`,
          message: issue.keyword === 'type'
            ? `类型应为 ${issue.params.type === 'array' ? 'list' : String(issue.params.type)}`
            : issue.message ?? issue.keyword,
        });
      }
    }
    collectEnvironmentReferences(candidate.value, missingEnv, environment);
    return Object.freeze({
      schemaAvailable: schema !== null,
      valid: errors.length === 0,
      errors: Object.freeze(errors),
      missingEnv: Object.freeze([...missingEnv].sort()),
    });
  }

  async readAllSchemas(): Promise<Record<string, unknown>> {
    return this.#afterMutations(async () => {
      const {document} = await this.#document.read();
      return this.#schemas.readAll(await this.#listKeys(document), document);
    });
  }

  listKeys(): Promise<string[]> {
    return this.#afterMutations(async () => {
      const { document } = await this.#document.read();
      return this.#listKeys(document);
    });
  }

  async #listKeys(document: RuntimeConfigDocument): Promise<string[]> {
    const keys = new Set<string>(Object.keys(readPluginConfigurationMap(document)));
    for (const key of HOST_CONFIG_KEYS) keys.add(key);
    for (const key of (await readPluginPackageMap(this.#projectRoot, document)).keys()) keys.add(key);
    return [...keys].sort((left, right) => left.localeCompare(right));
  }

  async #assertUnambiguousKey(document: RuntimeConfigDocument, key: string): Promise<void> {
    assertUnambiguousConfigKey(document, key);
    if (HOST_CONFIG_KEYS.includes(key) && (await readPluginPackageMap(this.#projectRoot, document)).has(key)) {
      throw new Error(`配置键 ${key} 同时指向 Host 与已声明插件；请在配置源码中明确编辑 ${key} 或 plugins.${key}`);
    }
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
  environment: Pick<EnvStore, 'has'>,
): void {
  if (typeof value === 'string') {
    for (const name of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu)) {
      if (!environment.has(name[1]!)) missingEnv.add(name[1]!);
    }
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectEnvironmentReferences(item, missingEnv, environment);
  }
}

export { configKeyPatch, configKeyRemovePatch, flattenConfigDocument } from './configuration-projection.js';
