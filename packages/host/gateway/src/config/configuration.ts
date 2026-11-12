import { isDeepStrictEqual } from 'node:util';
import {
  HOST_CONFIG_PATCH_PATHS, type ConsoleConfigApplication, type ConsoleConfigApplicationStatus, type ConsoleConfigApplyResult, type ConsoleConfigPatchRequest, type ConsoleConfigPatchResult, type ConsoleConfigProjectPatchResult, type ConsoleConfigProjectRead, type ConsoleConfigProjectReadRequest, type ConsoleConfigSource,
} from '@zhin.js/console-protocol';
import type { PluginConfigValidation } from '@zhin.js/host-http';
import {
  applyConfigPatches,
  readPluginConfigurationMap,
  rootPluginId,
  type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';
import { ConfigDocumentConflictError, ConfigValidationError, ConfigurationSupersededError, HOST_CONFIG_KEYS, readApplicationPluginDeclaration, parsePluginConfigSchema, createEnvStore, type ConfigFileDocument, type EnvStore } from '@zhin.js/runtime';
import { loadRuntimeEnvironmentLayers } from '../project/environment.js';
import { readPluginPackageMap } from './plugin-package-map.js';
import { assertUnambiguousConfigKey, configKeyPatch, configKeyRemovePatch, flattenConfigDocument } from './configuration-projection.js';
import { readEnvFile, writeEnvFile } from './environment-files.js';
import { PluginSchemaCatalog } from './plugin-schema-catalog.js';
import { hostModelOwnerId } from '@zhin.js/plugin-runtime';
import {
  assertChatConfigurationAccess, assertChatConfigurationScope, assertChatValueHasNoEnvironmentReference, assertChatOptionalLeaf, chatConfigurationLeaves, chatHostRoots, chatLeafTypes,
  ConfigChatAccessError, type ChatConfigurationScope,
} from './configuration-chat-policy.js';
import { isForbiddenConfigurationPathSegment } from './configuration-path.js';
import {
  assertPatchesInScope,
  normalizeConfigPatchOperations,
  readDeclaredPatchPaths,
  readPath,
  resolvePatchScope,
} from './configuration-patch.js';
import { maskConfigValue, REDACTED_CONFIG_VALUE } from './configuration-redaction.js';

export interface ChatConfigurationField {
  readonly path: readonly string[];
  readonly type: readonly string[];
}
export interface ChatConfigurationRead {
  readonly revision: string;
  /** `get`: the single leaf value (already proven non-sensitive). */
  readonly value?: unknown;
  /** `fields`: chat-manageable leaves under the scope; never values. */
  readonly fields?: readonly ChatConfigurationField[];
}
/** A Host-classified rejection before this operation attempted any commit. */
export class ConfigChatRequestRejectedError extends Error {
  readonly code = 'configuration_request_rejected';
  constructor() { super('配置操作在保存前失败，未保存。'); this.name = 'ConfigChatRequestRejectedError'; }
}
/** Only a thrown commit crosses this uncertainty boundary; never prepared cleanup. */
class ConfigCommitUnconfirmedError extends Error {
  constructor(cause: unknown) { super('Configuration commit outcome is unconfirmed', { cause }); }
}

/**
 * Top-level keys a trusted project patch must not write: Plugin declarations
 * (`configVersion` / `plugins` / `disable_plugins`) and the root Plugin section
 * (`plugin`). Declarations change which schema interprets business config, so they
 * stay with the source editor and Plugin management, not path patches.
 */
const PROJECT_PATCH_DECLARATION_KEYS: ReadonlySet<string> = new Set(['configVersion', 'plugins', 'disable_plugins', 'plugin']);

/** C3: Host chat whitelist is exactly the ordinary page patch allowlist. */
const CHAT_SCOPE: ChatConfigurationScope = Object.freeze({
  hostKeys: HOST_CONFIG_KEYS, hostPaths: HOST_CONFIG_PATCH_PATHS, declarationKeys: PROJECT_PATCH_DECLARATION_KEYS,
});
const MAX_CHAT_FIELDS = 256;

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

  /**
   * Trusted project administration (`config:patch-project`, full scope only). Same
   * single-CAS core as {@link patch}, without the page allowlist; it does not widen
   * `config:patch` / `HOST_CONFIG_PATCH_PATHS`. Declaration writes are rejected as
   * `invalid`, conflict values are masked, and a thrown commit is `unconfirmed`.
   */
  patchProject(request: Omit<ConsoleConfigPatchRequest, 'instanceKey'>): Promise<ConsoleConfigProjectPatchResult> {
    return this.#serialize(async () => {
      try { return await this.#patchCore({ expectedRevision: request.expectedRevision, patches: request.patches }, 'project'); }
      catch (error) {
        if (!(error instanceof ConfigCommitUnconfirmedError)) throw error;
        // The file may already hold the candidate. Do not retry or roll back.
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
        if (error instanceof ConfigChatAccessError || error instanceof ConfigChatRequestRejectedError) throw error;
        // The save boundary may have been crossed. Never misclassify an unknown
        // operation as an access denial or recommend repeating the write.
        throw new Error('配置保存或生效结果未确认，请先在 CLI 或 Console 核验当前状态。', { cause: error });
      }
    });
  }

  /** Shared single-CAS write: `scoped` keeps the page allowlist; `project` is the trusted full path. */
  async #patchCore(request: ConsoleConfigPatchRequest, mode: 'scoped' | 'project' | 'chat'): Promise<ConsoleConfigPatchResult> {
    let phase: 'prepare' | 'commit' | 'committed' = 'prepare';
    try {
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
      if (mode !== 'scoped') {
        const rejected = projectDeclarationErrors(current.document, paths);
        if (rejected.length > 0) {
          return Object.freeze({ status: 'invalid', revision: current.revision, errors: Object.freeze(rejected),
            missingEnv: Object.freeze([]), message: '插件声明不能通过项目补丁修改，未保存' });
        }
      }
      const conflict = async (snapshot: typeof current): Promise<ConsoleConfigPatchResult> => Object.freeze({
        status: 'conflict',
        revision: snapshot.revision,
        current: Object.freeze(await Promise.all(paths.map(async path => Object.freeze({ path,
          value: mode !== 'scoped' ? await this.#maskedValue(snapshot.document, path, { unknownSchema: 'redact' }) : readPath(snapshot.document, path) })))),
        message: '配置已被其他地方修改，未保存。请查看最新值后重试。',
      });
      if (current.revision !== request.expectedRevision) return await conflict(current);
      const candidate = applyConfigPatches(current.document, patches);
      // Chat writes exactly one leaf (C1/C4); scope and leaf shape are proven before values.
      if (mode === 'chat' && patches.length !== 1) throw new ConfigChatAccessError('leaf');
      if (mode === 'chat') for (const patch of patches) {
        assertChatConfigurationScope(patch.path, CHAT_SCOPE);
        if (patch.op === 'remove' && readPath(current.document, patch.path) === undefined) throw new ConfigChatAccessError('missing');
        const schema = await this.#chatSchema(current.document, patch.path);
        if (patch.op === 'remove') assertChatOptionalLeaf(schema, patch.path.slice(1));
        else {
          chatLeafTypes(schema, patch.path.slice(1));
          // M1: no new `${…}` / `env://` reference may be planted from chat.
          assertChatValueHasNoEnvironmentReference(patch.value);
        }
        await this.#assertChatPath(candidate, patch.path, [readPath(candidate, patch.path)]);
        if (readPath(current.document, patch.path) !== undefined) {
          await this.#assertChatPath(current.document, patch.path, [readPath(current.document, patch.path)]);
        }
        // Array removal shifts subsequent values into other schema positions.
        const parent = patch.path.slice(0, -1);
        if (patch.op === 'remove' && Array.isArray(readPath(current.document, parent))) {
          const values = [readPath(current.document, parent), readPath(candidate, parent)];
          await this.#assertChatPath(current.document, parent, values);
          await this.#assertChatPath(candidate, parent, values);
        }
      }
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
        phase = 'commit';
        if (mode === 'scoped') committed = await prepared.commit();
        else {
          try { committed = await prepared.commit(); }
          catch (error) {
            if (error instanceof ConfigDocumentConflictError) { phase = 'prepare'; throw error; }
            throw new ConfigCommitUnconfirmedError(error);
          }
        }
      } catch (error) {
        if (error instanceof ConfigDocumentConflictError) return await conflict(await this.#document.read());
        throw error;
      }
      phase = 'committed';
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

    } catch (error) {
      if (mode === 'chat') {
        if (phase === 'prepare') {
          if (error instanceof ConfigChatAccessError) throw error;
          throw new ConfigChatRequestRejectedError();
        }
        // A callback cannot reclassify a crossed commit as a pre-save failure.
        throw new Error('Configuration operation outcome is unconfirmed', { cause: error });
      }
      throw error;
    }
  }

  /**
   * Trusted project read (`config:get-project`, full scope only). Values are masked by
   * section schema, secret-like keys and unexpanded environment references unless the
   * caller explicitly asks to `reveal`; a section whose schema cannot be read is masked whole.
   */
  readProject(request: ConsoleConfigProjectReadRequest = {}): Promise<ConsoleConfigProjectRead> {
    return this.#afterMutations(async () => {
      const { document, revision } = await this.#document.read();
      const path = Object.freeze([...(request.path ?? [])]);
      const reveal = request.reveal === true;
      const value = path.length ? readPath(document, path) : document;
      if (value === undefined) return Object.freeze({ revision, path, exists: false, redacted: !reveal });
      // Only a verbatim whole-document reply needs its own copy; masking builds new values.
      if (reveal) return Object.freeze({ revision, path, exists: true, value: path.length ? value : structuredClone(document), redacted: false });
      let masked: unknown;
      if (path.length) masked = await this.#maskedValue(document, path, { unknownSchema: 'redact' });
      else {
        const keys = Object.keys(document);
        const schemas = await this.#schemas.readJsonMany(keys, document);
        masked = Object.freeze(Object.fromEntries(keys.map(key => {
          const schema = schemas.get(key);
          // Fail closed: without the schema we cannot rule out a schema-marked secret under an ordinary key.
          return [key, schema instanceof Error || schema === undefined ? REDACTED_CONFIG_VALUE
            : maskConfigValue(schema, [key], document[key], { unknownSchema: 'redact' })] as const;
        })));
      }
      return Object.freeze({ revision, path, exists: true, value: masked, redacted: true });
    });
  }

  /** Conflict evidence for trusted writes: never echo secrets or unexpanded references. */
  async #maskedValue(document: RuntimeConfigDocument, path: readonly string[],
    options?: Parameters<typeof maskConfigValue>[3]): Promise<unknown> {
    const value = readPath(document, path);
    if (value === undefined) return undefined;
    let schema: Readonly<Record<string, unknown>> | null;
    // Fail closed: without the schema we cannot rule out a schema-marked secret under an ordinary key.
    try { schema = await this.#schemas.readJson(path[0]!, document); }
    catch { return REDACTED_CONFIG_VALUE; }
    return maskConfigValue(schema, path, value, options);
  }

  async #chatSchema(document: RuntimeConfigDocument, path: readonly string[]): Promise<unknown> {
    if (!path.length) throw new ConfigChatAccessError('leaf');
    try { return await this.#schemas.readJson(path[0]!, document); }
    catch { throw new ConfigChatAccessError('unknown'); }
  }

  async #assertChatPath(document: RuntimeConfigDocument, path: readonly string[], values: readonly unknown[], deep = true): Promise<unknown> {
    assertChatConfigurationScope(path, CHAT_SCOPE);
    const schema = await this.#chatSchema(document, path);
    assertChatConfigurationAccess(schema, path.slice(1), values, deep, path);
    chatLeafTypes(schema, path.slice(1), values);
    return schema;
  }

  /** Leaves under `prefix` that pass the same scope, leaf and value checks as `get`. */
  async #chatFields(document: RuntimeConfigDocument, prefix: readonly string[]): Promise<readonly ChatConfigurationField[]> {
    if (prefix.length) {
      if (CHAT_SCOPE.declarationKeys.has(prefix[0]!)) throw new ConfigChatAccessError('scope');
      if (!CHAT_SCOPE.hostKeys.includes(prefix[0]!)) assertChatConfigurationScope(prefix, CHAT_SCOPE);
    }
    const roots: (readonly string[])[] = [];
    if (!prefix.length || CHAT_SCOPE.hostKeys.includes(prefix[0]!)) roots.push(...chatHostRoots(prefix, CHAT_SCOPE));
    if (!prefix.length) {
      for (const key of await this.#listKeys(document)) {
        if (!CHAT_SCOPE.hostKeys.includes(key) && !CHAT_SCOPE.declarationKeys.has(key)) roots.push([key]);
      }
    } else if (!CHAT_SCOPE.hostKeys.includes(prefix[0]!)) roots.push(prefix);
    if (prefix.length && !roots.length) throw new ConfigChatAccessError('scope');
    const fields: ChatConfigurationField[] = [];
    for (const root of roots) {
      let schema: unknown;
      try { schema = await this.#chatSchema(document, root); }
      catch (error) { if (error instanceof ConfigChatAccessError) continue; throw error; }
      for (const relative of chatConfigurationLeaves(schema, root.slice(1), MAX_CHAT_FIELDS)) {
        if (fields.length >= MAX_CHAT_FIELDS) break;
        const path = Object.freeze([root[0]!, ...relative]);
        try {
          await this.#assertChatPath(document, path, [readPath(document, path)]);
          fields.push(Object.freeze({ path, type: chatLeafTypes(schema, relative) }));
        } catch (error) { if (!(error instanceof ConfigChatAccessError)) throw error; }
      }
    }
    return Object.freeze(fields);
  }

  /**
   * Host-authenticated owner chat reads (C1). `get` returns one proven-safe leaf;
   * `fields` lists manageable leaves and their types without values. Denials carry
   * only a reason code.
   */
  readChat(path: readonly string[], mode: 'get' | 'fields'): Promise<ChatConfigurationRead> {
    return this.#afterMutations(async () => {
      try {
        if (!Array.isArray(path) || path.some(key => typeof key !== 'string' || !key || isForbiddenConfigurationPathSegment(key))) throw new ConfigChatAccessError('unknown');
        const { document, revision } = await this.#document.read();
        if (mode === 'fields') return Object.freeze({ revision, fields: await this.#chatFields(document, path) });
        assertChatConfigurationScope(path, CHAT_SCOPE);
        const schema = await this.#chatSchema(document, path);
        chatLeafTypes(schema, path.slice(1));
        const value = readPath(document, path);
        await this.#assertChatPath(document, path, [value]);
        if (value === undefined) throw new ConfigChatAccessError('missing');
        return Object.freeze({ revision, value });
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
    if (pluginName && !HOST_CONFIG_KEYS.includes(pluginName)
      && !readApplicationPluginDeclaration(document).instances.some(item => item.instanceKey === pluginName)) {
      // Installed but undeclared Plugin package (`needsConfiguration`): read-only form for the declare flow.
      const undeclared = await this.#schemas.readUndeclared(pluginName, document);
      if (undeclared !== undefined) {
        // Package resolution is async: re-check against the latest document so a declaration
        // committed meanwhile is not reported as `declared: false`.
        const latest = (await this.#document.read()).document;
        const stillUndeclared = await this.#schemas.readUndeclared(pluginName, latest);
        if (stillUndeclared !== undefined) return stillUndeclared;
        await this.#assertUnambiguousKey(latest, pluginName);
        return this.#schemas.read(pluginName, latest);
      }
    }
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
    if (pluginName === 'ai') {
      // Startup composition deliberately retains legacy data for explicit
      // migration. A normal structured save must still pass its real consumer.
      const { loadAiConfigUtils } = await import('./ai-config-loader.js');
      const validate = loadAiConfigUtils(this.#projectRoot)?.validateModelRuntimeConfig;
      const messages = validate
        ? validate(candidate.errors.length === 0 ? candidate.value : data, hostModelOwnerId(this.#projectRoot))
        : ['AI configuration validation requires the installed Agent package'];
      if (messages.length) return Object.freeze({ schemaAvailable: schema !== null, valid: false,
        errors: Object.freeze(messages.map(message => ({ path: '$', message }))), missingEnv: Object.freeze([]) });
    }
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

  /**
   * Lock order: this Console store's domain lock (the mutation tail) is taken first,
   * then the Root configuration queue via `#applyConfiguration` / `#validateConfiguration`.
   * Root control must never call back into this store while holding its queue, or the
   * two locks would wait on each other.
   */
  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutationTail.then(operation);
    this.#mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

/** Project patches may write Host and declared Plugin business config, never declarations. */
function projectDeclarationErrors(document: RuntimeConfigDocument, paths: readonly (readonly string[])[]): Array<{ path: string; message: string }> {
  const declared = new Set(readApplicationPluginDeclaration(document).instances.map(instance => instance.instanceKey));
  const errors: Array<{ path: string; message: string }> = [];
  for (const section of new Set(paths.map(path => path[0]!))) {
    if (PROJECT_PATCH_DECLARATION_KEYS.has(section)) {
      errors.push({ path: `$.${section}`, message: '插件声明与根插件配置请用 gateway.plugins.declare、配置源码或插件管理修改' });
    } else if (!HOST_CONFIG_KEYS.includes(section) && !declared.has(section)) {
      errors.push({ path: `$.${section}`, message: '未声明的插件实例；请先用 gateway.plugins.declare 声明' });
    }
  }
  return errors;
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
