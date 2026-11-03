import { ConfigDocumentConflictError, type ConfigFileDocument } from '@zhin.js/config-file';
import { isDeepStrictEqual } from 'node:util';
import type { ConsoleConfigApplication, ConsoleConfigApplicationStatus, ConsoleConfigApplyResult, ConsoleConfigPatchRequest, ConsoleConfigPatchResult, ConsoleConfigProjectPatchResult, ConsoleConfigSource } from '@zhin.js/console-protocol';
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
import { assertChatConfigurationAccess, chatConfigurationSchema, ConfigChatAccessError } from './configuration-chat-policy.js';
import {
  assertPatchesInScope,
  normalizeConfigPatchOperations,
  readDeclaredPatchPaths,
  readPath,
  resolvePatchScope,
} from './configuration-patch.js';

export interface ChatConfigurationRead extends ConsoleConfigApplicationStatus {
  readonly revision: string;
  readonly value?: unknown;
  readonly keys?: readonly string[];
  readonly schema?: unknown;
}
/** Only a thrown commit crosses this uncertainty boundary; never prepared cleanup. */
class ConfigCommitUnconfirmedError extends Error {
  constructor(cause: unknown) { super('Configuration commit outcome is unconfirmed', { cause }); }
}
const declarationSchemas: Readonly<Record<string, Readonly<Record<string, unknown>>>> = Object.freeze({
  configVersion: { type: 'integer', const: 2 },
  plugins: { type: 'object', additionalProperties: { type: 'string' } },
  disable_plugins: { type: 'array', items: { type: 'string' } },
});

/** Allow only Runtime's fixed metadata vocabulary into a chat response. */
function chatApplication(application: ConsoleConfigApplication | undefined): ConsoleConfigApplication | undefined {
  if (!application) return undefined;
  const nonnegative = (value: number) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  return Object.freeze({ operationId: /^config:[a-f0-9-]+:[0-9]+$/u.test(application.operationId) ? application.operationId : 'configuration-status',
    sourceRevision: /^[a-f0-9]{64}$/u.test(application.sourceRevision) ? application.sourceRevision : '', saved: application.saved === true,
    generation: nonnegative(application.generation), applicationRevision: nonnegative(application.applicationRevision),
    groups: Object.freeze(application.groups.map((group, index) => Object.freeze({ id: `group-${index + 1}`, paths: Object.freeze([]),
      effect: ['in-place', 'replace-resource', 'reconnect-endpoint', 'reload-plugin', 'restart-process'].includes(group.effect) ? group.effect : 'replace-resource',
      status: ['applied', 'restart-pending', 'blocked', 'failed', 'superseded', 'unknown'].includes(group.status) ? group.status : 'unknown',
      dependsOn: Object.freeze([]),
    }))) });
}

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
    return this.#serialize(() => this.#patchCore(request, 'scoped'));
  }

  /** Trusted operator path; it does not widen the ordinary Console patch scope. */
  patchProject(request: Omit<ConsoleConfigPatchRequest, 'instanceKey'>): Promise<ConsoleConfigProjectPatchResult> {
    return this.#serialize(async () => {
      try { return await this.#patchCore(request, 'project'); }
      catch (error) {
        if (!(error instanceof ConfigCommitUnconfirmedError)) throw error;
        return Object.freeze({ status: 'unconfirmed', expectedRevision: request.expectedRevision,
          message: 'Configuration save outcome is unconfirmed; inspect source and runtime status before any further write' });
      }
    });
  }

  /** Host-authenticated owner chat. Policy checks share the mutation's CAS boundary. */
  patchChat(request: Omit<ConsoleConfigPatchRequest, 'instanceKey'>): Promise<ConsoleConfigPatchResult> {
    return this.#serialize(async () => {
      try {
        const result = await this.#patchCore(request, 'chat');
        if (result.status === 'conflict') return Object.freeze({ ...result, current: Object.freeze([]) });
        if (result.status === 'invalid') return Object.freeze({ ...result, errors: Object.freeze([{ path: '$', message: '配置校验失败，未保存' }]), missingEnv: Object.freeze([]) });
        return Object.freeze({ ...result, missingEnv: Object.freeze([]), application: chatApplication(result.application) });
      } catch (error) {
        if (error instanceof ConfigChatAccessError) throw error;
        // The save boundary may have been crossed. Never misclassify an unknown
        // operation as an access denial or recommend repeating the write.
        throw new Error('配置保存或生效结果未确认，请先在 CLI 或 Console 核验当前状态。');
      }
    });
  }

  async #patchCore(request: ConsoleConfigPatchRequest, mode: 'scoped' | 'project' | 'chat'): Promise<ConsoleConfigPatchResult> {
    const instanceKey = request.instanceKey;
      const patches = normalizeConfigPatchOperations(request.patches);
      const current = await this.#document.read();
      if (mode === 'scoped') {
      const declared = instanceKey === undefined
        ? []
        : readDeclaredPatchPaths(await this.#ownSchema(current.document, instanceKey), instanceKey);
      const allowed = resolvePatchScope(current.document, instanceKey, declared);
      assertPatchesInScope(patches, allowed, instanceKey === undefined ? 'Host 白名单' : `插件 ${instanceKey}`);
      }
      const paths = Object.freeze(patches.map(patch => patch.path));
      const conflict = (snapshot: typeof current): ConsoleConfigPatchResult => Object.freeze({
        status: 'conflict',
        revision: snapshot.revision,
        current: Object.freeze(paths.map(path => Object.freeze({ path, value: readPath(snapshot.document, path) }))),
        message: '配置已被其他地方修改，未保存。请查看最新值后重试。',
      });
      if (current.revision !== request.expectedRevision) return conflict(current);
      const candidate = applyConfigPatches(current.document, patches);
      readApplicationPluginDeclaration(candidate);
      if (mode === 'chat') for (const patch of patches) {
        const section = patch.path[0];
        // A removed Plugin namespace has no next schema. Its old authority and
        // the binding closure below still prove the whole affected old value.
        const removedNamespace = !HOST_CONFIG_KEYS.includes(section) && !Object.hasOwn(declarationSchemas, section)
          && typeof readPath(current.document, ['plugins', section]) === 'string'
          && readPath(candidate, ['plugins', section]) === undefined && readPath(candidate, [section]) === undefined;
        if (!removedNamespace) await this.#assertChatPath(candidate, patch.path, [readPath(candidate, patch.path)]);
        // Rebinding a Plugin cannot hide the old schema or erase an existing secret.
        if (readPath(current.document, patch.path) !== undefined) await this.#assertChatPath(current.document, patch.path, [readPath(current.document, patch.path)]);
        // Removing an array item shifts later values into different schema
        // positions. Their entire parent is the affected safety unit.
        const parent = patch.path.slice(0, -1);
        if (patch.op === 'remove' && Array.isArray(readPath(current.document, parent))) {
          const values = [readPath(current.document, parent), readPath(candidate, parent)];
          await this.#assertChatPath(current.document, parent, values);
          await this.#assertChatPath(candidate, parent, values);
        }
      }
      if (mode === 'chat') await this.#assertChatBindingChanges(current.document, candidate);
      const sections = [...new Set(patches.map(patch => patch.path[0]!))];
      const errors: Array<{ path: string; message: string }> = [];
      const missingEnv = new Set<string>();
      for (const section of sections) {
        // Declaration structure was checked as one complete candidate above;
        // these are not ordinary per-plugin configuration blocks.
        if (mode !== 'scoped' && Object.hasOwn(declarationSchemas, section)) continue;
        if (candidate[section] === undefined) continue;
        const validation = await this.validatePluginConfig(section, candidate[section], candidate);
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
        try { await this.#validatePrepared(prepared); }
        catch (error) {
          if (!(error instanceof ConfigValidationError)) throw error;
          // Runtime validation may report cross-field constraints without a
          // structured path. Preserve the invalid contract at the document
          // boundary; arbitrary issue strings can contain private values.
          return Object.freeze({ status: 'invalid', revision: current.revision,
            errors: Object.freeze([Object.freeze({ path: '$', message: '完整配置未通过运行校验' })]),
            missingEnv: Object.freeze([...missingEnv].sort()), message: '配置校验失败，未保存' });
        }
        try { committed = await prepared.commit(); }
        catch (error) {
          if (error instanceof ConfigDocumentConflictError) throw error;
          throw new ConfigCommitUnconfirmedError(error);
        }
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
  }

  async #assertChatPath(document: RuntimeConfigDocument, path: readonly string[], values: readonly unknown[], deep = true): Promise<unknown> {
    if (!path.length) throw new ConfigChatAccessError('unknown');
    let schema: unknown;
    try { schema = declarationSchemas[path[0]] ?? await this.#schemas.readJson(path[0], document); }
    catch { throw new ConfigChatAccessError('unknown'); }
    assertChatConfigurationAccess(schema, path.slice(1), values, deep, path);
    return schema;
  }

  async #assertChatBindingChanges(previous: RuntimeConfigDocument, next: RuntimeConfigDocument): Promise<void> {
    const before = new Map(readApplicationPluginDeclaration(previous).instances.map(instance => [instance.instanceKey, instance.package]));
    const after = new Map(readApplicationPluginDeclaration(next).instances.map(instance => [instance.instanceKey, instance.package]));
    for (const alias of new Set([...before.keys(), ...after.keys()])) {
      if (before.get(alias) === after.get(alias)) continue;
      // A binding defines the interpretation of existing business configuration.
      // Check both authorities, not only the public package-string patch path.
      const values = [readPath(previous, [alias]), readPath(next, [alias])];
      if (before.has(alias)) await this.#assertChatPath(previous, [alias], values);
      if (after.has(alias)) await this.#assertChatPath(next, [alias], values);
    }
  }

  readChat(path: readonly string[], mode: 'get' | 'list' | 'schema' | 'status'): Promise<ChatConfigurationRead> {
    return this.#afterMutations(async () => {
      try {
        if (!Array.isArray(path) || path.some(key => typeof key !== 'string' || !key || ['__proto__', 'constructor', 'prototype'].includes(key))) throw new ConfigChatAccessError('unknown');
        const { document, revision } = await this.#document.read();
        const application = this.#readApplication?.();
        if (application && application.operationId !== this.#applicationErrorAtOperationId) this.#applicationError = undefined;
        if (mode === 'status') return Object.freeze({ revision, application: chatApplication(application), ...(this.#applicationError ? { applicationError: this.#applicationError } : {}) });
        const value = readPath(document, path);
        if (mode === 'get') {
          await this.#assertChatPath(document, path, [value]);
          if (value === undefined) throw new ConfigChatAccessError('missing');
          return Object.freeze({ revision, value });
        }
        if (!path.length) {
          const keys: string[] = [];
          for (const key of await this.#listKeys(document)) {
            try { await this.#assertChatPath(document, [key], [], false); keys.push(key); }
            catch (error) { if (!(error instanceof ConfigChatAccessError)) throw error; }
          }
          return Object.freeze({ revision, ...(mode === 'list' ? { keys: Object.freeze(keys) } : { schema: { type: ['object'], properties: Object.fromEntries(keys.map(key => [key, {}])) } }) });
        }
        const schema = await this.#assertChatPath(document, path, [value], false);
        const summary = chatConfigurationSchema(schema, path.slice(1), value);
        return Object.freeze({ revision, ...(mode === 'list' ? { keys: Object.freeze(Object.keys(summary.properties as object)) } : { schema: summary }) });
      } catch (error) {
        if (error instanceof ConfigChatAccessError) throw error;
        throw new ConfigChatAccessError('unknown');
      }
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
