import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify, isDeepStrictEqual } from 'node:util';
import { createConfigDocument, JsonConfigDocument } from '@zhin.js/config-file';
import { loadProjectConfig, packageToInstanceKey } from '@zhin.js/scaffold-wizard';
import { NodePackageResolver, PackageResolutionError, ProjectGraphService, primaryConfigToken, parsePluginConfigSchema, envStoreToken, runtimeEnvironmentToken, type EnvStore, type RuntimeEnvironment, type ResolvedPackage, readApplicationPluginDeclaration } from '@zhin.js/runtime';
import {
  pluginVerificationToken, rootPluginId, readPluginConfigurationMap,
  type SnapshotReader, type PluginNodeSnapshot, type RuntimeSnapshot, type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';
import type {
  PluginInstallPlan, PluginManagementPort, PluginManagementState,
  PluginUninstallPlan, PluginUpdatePlan, PluginVerificationResult, PluginVerificationPlan,
} from '@zhin.js/host-http';
import { ConsoleConfigurationStore } from '../plugin-runtime/console/configuration.js';
import { explainConfigFields } from './config-explanation.js';
import type { ConsoleConfigExplanation } from '@zhin.js/console-protocol';
import { adapterFeatureId, isAdapterIndex } from '@zhin.js/adapter';
import type { PluginManagementActivity } from './activity.js';
import { readPluginLifecycleState, resolvePluginLifecycleFile } from '../plugin-runtime/plugin-lifecycle-store.js';

const execute = promisify(execFile);
type Project = { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; devDependencies?: Record<string, string>; zhin?: { plugins?: { package: string; instanceKey: string }[] } };

export interface PluginManagementOptions {
  readonly activity?: PluginManagementActivity;
  readonly snapshots?: SnapshotReader;
  readonly requestRestart?: () => void | Promise<void>;
  /** Real package-manager boundary; tests use independent on-disk packages. */
  readonly installDependencies?: (args: readonly string[], projectRoot: string) => Promise<void>;
  readonly lifecycleFile?: string;
}
export interface PluginInstallOptions {
  readonly enable?: boolean;
  readonly saveDev?: boolean;
  readonly source?: string;
}

/** One installation authority for CLI and Console. No generation or package parser of its own. */
export class PluginManagementWorkflow implements PluginManagementPort {
  readonly #root: string;
  readonly #options: PluginManagementOptions;
  readonly #verificationIncarnation = randomUUID();
  constructor(projectRoot: string, options: PluginManagementOptions = {}) {
    this.#root = resolve(projectRoot);
    this.#options = options;
  }

  async #project() {
    const document = new JsonConfigDocument(join(this.#root, 'package.json'));
    const source = await document.read();
    return { document, source, project: source.document as Project };
  }

  #configuration(snapshot?: RuntimeSnapshot) {
    const loaded = loadProjectConfig(this.#root);
    if (loaded.status === 'missing') return undefined;
    if (loaded.status !== 'loaded' || !loaded.configPath) throw new Error(loaded.message ?? 'Root configuration must use YAML or JSON');
    const document = createConfigDocument(loaded.configPath);
    return { document, store: this.#configurationStore(document, snapshot) };
  }

  #configurationStore(document: import('@zhin.js/config-file').ConfigFileDocument, snapshot?: RuntimeSnapshot) {
    // inspect already holds this lease. Other callers continue to resolve a fresh
    // generation per operation, without maintaining a parallel runtime view.
    const acquire = () => snapshot ? { value: snapshot, release() {} } : this.#options.snapshots?.acquire();
    return new ConsoleConfigurationStore({ projectRoot: this.#root, document,
      environmentName: () => {
        const lease = acquire();
        try { return (lease?.value.resources.get(rootPluginId())?.get(runtimeEnvironmentToken.id) as RuntimeEnvironment | undefined)?.name ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development'); }
        finally { lease?.release(); }
      },
      environmentForPlugin: instanceKey => {
        const lease = acquire();
        try {
          const node = [...(lease?.value.tree.values() ?? [])].find(item => item.parent === rootPluginId() && item.instanceKey === instanceKey);
          return node ? lease?.value.resources.get(node.id)?.get(envStoreToken.id) as EnvStore | undefined : undefined;
        } finally { lease?.release(); }
      },
      configDeclarations: async () => {
        const lease = acquire();
        try {
          const nodes = [...(lease?.value.tree.values() ?? [])].filter(node => node.configSchema && node.packageVersion);
          if (!nodes.length) return new Map();
          const resolver = await NodePackageResolver.create(this.#root);
          const current = await Promise.all(nodes.map(async node => {
            const installed = await resolver.loadPackage(node.packageRoot);
            return installed.name === node.packageName && installed.packageJson.version === node.packageVersion
              ? [[node.packageRoot, node.configSchema!] as const] : [];
          }));
          return new Map(current.flat());
        }
        finally { lease?.release(); }
      },
    });
  }

  async #declaredEntries() {
    const configuration = this.#configuration();
    const config = configuration ? (await configuration.document.read()).document : {};
    const declaration = readApplicationPluginDeclaration(config);
    if ((await this.#project()).project.zhin?.plugins?.length) throw new Error('Legacy package.json zhin.plugins detected; run zhin migrate instances');
    return declaration.instances;
  }

  async #resolveTarget(request: string, declaredEntries?: readonly { package: string; instanceKey: string }[]) {
    const entries = declaredEntries ?? await this.#declaredEntries();
    if (request.startsWith('root/')) request = request.slice(5);
    const direct = entries.find(entry => entry.instanceKey === request);
    if (direct) return { packageName: direct.package, instanceKey: direct.instanceKey };
    const matches = entries.filter(entry => entry.package === request);
    if (matches.length > 1) throw new Error('此包存在多个插件实例，请使用精确 instanceKey');
    if (matches.length === 1) return { packageName: matches[0]!.package, instanceKey: matches[0]!.instanceKey };
    const spec = npmSpec(request);
    return { packageName: spec.name, instanceKey: packageToInstanceKey(spec.name) };
  }

  async #installed(packageName: string) {
    let pkg: ResolvedPackage | undefined;
    let resolutionError: unknown;
    try {
      const resolver = await NodePackageResolver.create(this.#root);
      const root = await resolver.root(this.#root);
      pkg = await resolver.resolve(packageName, root);
    } catch (error) { resolutionError = error; }
    if (pkg) {
      try {
        if (pkg.packageJson.zhin.type !== 'plugin') throw new Error(`${packageName} is a Feature package, not a Plugin`);
        await access(join(pkg.root, pkg.packageJson.zhin.entry));
        return { installed: true, plugin: true, version: pkg.packageJson.version ?? null, error: undefined, pkg };
      } catch (error) { return { installed: true, plugin: false, version: pkg.packageJson.version ?? null, error: errorMessage(error), pkg }; }
    }
    // Undeclared npm packages/ordinary dependencies still need installation evidence.
    // Never guess a local/workspace directory: those are owned solely by the Runtime resolver.
    if (packageName.startsWith('./')) return { installed: false, plugin: false, version: null, error: errorMessage(resolutionError) };
    const directory = join(this.#root, 'node_modules', ...packageName.split('/'));
    let raw: { name?: string; version?: string; zhin?: unknown };
    try { raw = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as typeof raw; }
    catch (error) { if (notFound(error)) return { installed: false, plugin: false, version: null, error: undefined }; throw error; }
    if (raw.name !== packageName) throw new Error(`Installed package name does not match ${packageName}`);
    const version = typeof raw.version === 'string' ? raw.version : null;
    if (!raw.zhin) return { installed: true, plugin: false, version, error: undefined };
    try {
      const resolver = await NodePackageResolver.create(this.#root);
      const installedPackage = await resolver.loadPackage(directory);
      if (installedPackage.packageJson.zhin.type !== 'plugin') throw new Error(`${packageName} is a Feature package, not a Plugin`);
      await access(join(installedPackage.root, installedPackage.packageJson.zhin.entry));
      const declarationMissing = resolutionError instanceof PackageResolutionError && resolutionError.message.includes('does not declare');
      return { installed: true, plugin: true, version, error: declarationMissing ? errorMessage(resolutionError) : undefined, pkg: installedPackage };
    } catch (error) { return { installed: true, plugin: false, version, error: errorMessage(error) }; }
  }

  async #checkDependencies(candidate?: { packageName: string; instanceKey: string }, capturedDocument?: RuntimeConfigDocument) {
    const resolver = await NodePackageResolver.create(this.#root);
    const root = await resolver.root(this.#root);
    if (root.packageJson.zhin.type !== 'plugin') throw new Error('Project root is not a Plugin');
    const configuration = capturedDocument ? undefined : this.#configuration();
    const document = capturedDocument ?? (configuration ? (await configuration.document.read()).document : {});
    readApplicationPluginDeclaration(document);
    const next = candidate ? { ...document, plugins: {...document.plugins as Record<string, unknown>, [candidate.instanceKey]: candidate.packageName} } : document;
    readApplicationPluginDeclaration(next);
    await new ProjectGraphService(resolver).inspect(this.#root, next);
  }

  async #revisions() {
    const { source } = await this.#project();
    const config = this.#configuration();
    const revision = config ? (await config.document.read()).revision : null;
    return { revision, projectRevision: createHash('sha256').update(JSON.stringify([source.revision, revision])).digest('hex') };
  }

  async inspect(request: string): Promise<PluginManagementState> {
    const lease = this.#options.snapshots?.acquire();
    try { return await this.#inspect(request, lease?.value); }
    finally { lease?.release(); }
  }

  async #inspect(request: string, snapshot?: RuntimeSnapshot): Promise<PluginManagementState> {
    const { configuration, source, document, declaration, projectRevision } = await this.#configurationObservation(snapshot);
    const entries = declaration.instances;
    const target = await this.#resolveTarget(request, entries);
    const installed = await this.#installed(target.packageName);
    const declared = entries.some(entry => entry.package === target.packageName && entry.instanceKey === target.instanceKey);
    const config = readPluginConfigurationMap(document);
    const revision = source.revision;
    const issues: string[] = installed.error ? [installed.error] : [];
    if (declared && !installed.installed) issues.push('Declared plugin package is not installed');
    let dependencies: PluginManagementState['dependencies'] = 'unchecked';
    let validation: PluginManagementState['validation'] = null;
    const legacy = await readPluginLifecycleState(this.#options.lifecycleFile ?? resolvePluginLifecycleFile(this.#root));
    if (legacy.disabled.length) throw new Error('Legacy plugin lifecycle state detected; run zhin migrate instances');
    const disabled = declaration.disabled.includes(target.instanceKey);
    if (installed.plugin && declared && !disabled) {
      try { await this.#checkDependencies(undefined, document); dependencies = 'passed'; }
      catch (error) { dependencies = 'failed'; issues.push(errorMessage(error)); }
      validation = await configuration.store.validatePluginConfig(target.instanceKey, config[target.instanceKey] ?? {}, document);
    }

    let node: PluginNodeSnapshot | undefined;
    let generation: number | null = null;
    let published = false;
    let readiness: PluginManagementState['readiness'] = 'unknown';
    let verification: PluginManagementState['verification'] = 'not-configured';
    {
      generation = snapshot?.generation ?? null;
      node = snapshot && [...snapshot.tree.values()].find(item => item.parent === rootPluginId() && item.instanceKey === target.instanceKey && item.packageName === (installed.pkg?.name ?? target.packageName));
      if (node && snapshot) {
        const owner = node.id;
        const primary = snapshot.resources.get(rootPluginId())?.get(primaryConfigToken.id) as import('@zhin.js/runtime').PrimaryConfig | undefined;
        const applied = primary ? readPluginConfigurationMap(primary.document) : undefined;
        const candidate = node.configSchema ? parsePluginConfigSchema(node.configSchema, config[target.instanceKey]).value : config[target.instanceKey] ?? {};
        published = Boolean(installed.version && node.packageVersion === installed.version && applied && isDeepStrictEqual(applied[target.instanceKey] ?? {}, candidate));
        if (published) {
          const hasAdapters = [...snapshot.capabilities.values()].some(slot => slot.owner === owner && String(slot.feature) === 'zhin.adapter');
          if (!hasAdapters) readiness = 'ready';
          else {
            const adapters = snapshot.projections.get(adapterFeatureId);
            if (isAdapterIndex(adapters)) {
              const endpoints = adapters.describe().filter(endpoint => endpoint.owner === owner);
              if (endpoints.length) readiness = endpoints.every(endpoint => endpoint.connected && endpoint.admitted)
                ? 'ready' : endpoints.some(endpoint => endpoint.transportState === 'closed' || endpoint.transportState === 'stopped')
                  ? 'degraded' : endpoints.some(endpoint => endpoint.transportState === 'unknown') ? 'unknown' : 'pending';
            }
          }
        }
        if (snapshot.resources.get(node.id)?.has(pluginVerificationToken.id)) verification = 'available';
      }
    }
    // Publication compares this file's default-completed semantics with the
    // generation authority; it does not attest an applied raw-file revision.
    const missingConfig = declared && (validation?.valid === false || Boolean(validation?.missingEnv.length));
    const restartRequired = declared && (disabled ? Boolean(node) : !published || dependencies !== 'passed');
    const status: PluginManagementState['status'] = issues.length ? 'degraded'
      : missingConfig ? 'missing-config'
      : published && !disabled ? 'enabled'
      : restartRequired ? 'pending-restart'
      : declared ? 'declared' : installed.installed ? 'installed' : 'not-installed';
    await this.#assertConfigurationObservation(projectRevision, snapshot);
    return Object.freeze({ ...target, revision, projectRevision, installed: installed.installed, plugin: installed.plugin, version: installed.version, declared, status, dependencies, validation, generation, published, readiness, restartRequired, disabled, issues: Object.freeze(issues), verification });
  }

  async #configurationObservation(snapshot?: RuntimeSnapshot) {
    const project = await this.#project();
    const configuration = this.#configuration(snapshot);
    if (!configuration) throw new Error('Missing configVersion: 2 configuration; run zhin setup');
    const source = await configuration.document.read();
    const document = source.document;
    const declaration = readApplicationPluginDeclaration(document);
    if (project.project.zhin?.plugins?.length) throw new Error('Legacy package.json zhin.plugins detected; run zhin migrate instances');
    const projectRevision = createHash('sha256').update(JSON.stringify([project.source.revision, source.revision])).digest('hex');
    return { project, configuration, source, document, declaration, projectRevision };
  }
  async #assertConfigurationObservation(projectRevision: string, snapshot?: RuntimeSnapshot): Promise<void> {
    if ((await this.#revisions()).projectRevision !== projectRevision) throw new Error('配置或项目版本在读取期间变化，请重新读取应用证据');
    const current = this.#options.snapshots?.acquire();
    try {
      if (current?.value !== snapshot) throw new Error('运行代在读取期间变化，请重新读取应用证据');
    } finally { current?.release(); }
  }

  /** Full-scope, metadata-only projection over the same file and generation observation as inspect. */
  async explainConfiguration(instanceKey: string, expectedRevision: string): Promise<ConsoleConfigExplanation> {
    if (typeof instanceKey !== 'string' || instanceKey.length > 128 || !/^[a-z0-9][a-z0-9-]*$/u.test(instanceKey)
      || typeof expectedRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedRevision)) throw new Error('请提供精确实例键及已读取的文件版本');
    const lease = this.#options.snapshots?.acquire();
    try {
      const snapshot = lease?.value;
      const { source, document, declaration, projectRevision } = await this.#configurationObservation(snapshot);
      if (source.revision !== expectedRevision) throw new Error('配置文件版本已变化，请刷新后重新读取解释');
      const base = { instanceKey, revision: source.revision, projectRevision, generation: snapshot?.generation ?? null };
      const unsupported = (reason: NonNullable<ConsoleConfigExplanation['reason']>): ConsoleConfigExplanation => ({ ...base, projection: 'unsupported', reason, fields: [] });
      const entry = declaration.instances.find(item => item.instanceKey === instanceKey);
      const node = snapshot && [...snapshot.tree.values()].find(item => item.parent === snapshot.root && item.instanceKey === instanceKey);
      let result: ConsoleConfigExplanation;
      if (!entry || !node || declaration.disabled.includes(instanceKey)) result = unsupported('instance-unavailable');
      else {
        const installed = await this.#installed(entry.package);
        const primary = snapshot?.resources.get(snapshot.root)?.get(primaryConfigToken.id) as import('@zhin.js/runtime').PrimaryConfig | undefined;
        if (!installed.plugin || !installed.pkg || installed.pkg.root !== node.packageRoot || installed.pkg.name !== node.packageName
          || !installed.version || installed.version !== node.packageVersion) result = unsupported('schema-drift');
        else if (!node.configSchema) result = unsupported('schema-unavailable');
        else if (primary?.compositionMode !== 'document') result = unsupported('custom-resolver');
        else result = { ...base, ...explainConfigFields(node.configSchema, readPluginConfigurationMap(document)[instanceKey],
          snapshot?.config.get(node.id), readPluginConfigurationMap(primary.document)[instanceKey]) };
      }
      await this.#assertConfigurationObservation(projectRevision, snapshot);
      return Object.freeze(result);
    } catch { throw new Error('配置解释未确认，请重新读取文件版本与当前运行状态；原配置未改动。'); }
    finally { lease?.release(); }
  }

  async planInstall(request: string, options: Pick<PluginInstallOptions, 'enable'> = {}): Promise<PluginInstallPlan> {
    const spec = npmSpec(request);
    const state = await this.inspect(spec.name);
    if (state.declared && state.packageName !== spec.name) throw new Error(`Instance ${state.instanceKey} already references ${state.packageName}; install by the package name or edit its declaration explicitly`);
    const config = this.#configuration();
    const document = config ? await config.store.readDocument() : {};
    const enable = options.enable !== false;
    const raw = config ? (await config.document.read()).document : {};
    const v2 = readApplicationPluginDeclaration(raw).version === 2;
    if (v2 && enable) readApplicationPluginDeclaration({...raw, plugins: {...raw.plugins as Record<string, unknown>, [state.instanceKey]: spec.name}});
    return Object.freeze({ packageName: spec.name, instanceKey: state.instanceKey, projectRevision: state.projectRevision, configurationRevision: state.revision, alreadyInstalled: state.installed, alreadyDeclared: state.declared, restartRequired: enable ? !state.declared || state.restartRequired : state.declared && state.restartRequired, changes: Object.freeze({ packageManifest: v2 || !enable || state.declared ? 'unchanged' : 'add-plugin', config: !enable ? 'unchanged' : !config ? 'schema-required' : Object.hasOwn(document, state.instanceKey) ? 'unchanged' : 'create-entry' }), warnings: Object.freeze([...state.issues, ...(enable && !config ? ['Root YAML/JSON 配置文件缺失，请先运行 zhin setup'] : []), '安装/声明不表示业务验证通过；配置就绪后显式 apply 和 verify']) });
  }

  async #assertRevision(expectedRevision?: string, expectedProjectRevision?: string) {
    const current = await this.#revisions();
    if (expectedRevision !== undefined && current.revision !== expectedRevision || expectedProjectRevision !== undefined && current.projectRevision !== expectedProjectRevision) throw new Error('项目或配置已被其他会话修改，请刷新后重试');
    return current;
  }

  async #mutate<T>(operation: (completed: string[]) => Promise<T>, request?: string): Promise<T> {
    return this.#options.activity
      ? this.#options.activity.run(() => this.#mutateLocked(operation, request))
      : this.#mutateLocked(operation, request);
  }

  async #mutateLocked<T>(operation: (completed: string[]) => Promise<T>, request?: string): Promise<T> {
    const directory = join(this.#root, '.zhin');
    await mkdir(directory, { recursive: true });
    const file = join(directory, 'plugin-management.lock');
    let handle;
    try { handle = await open(file, 'wx', 0o600); }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      let detail = '另一进程正在管理插件';
      try {
        const previous = JSON.parse(await readFile(file, 'utf8')) as { pid: number };
        try { process.kill(previous.pid, 0); }
        catch (probe) { if (probe instanceof Error && 'code' in probe && probe.code === 'ESRCH') detail = `上一次插件管理进程 ${previous.pid} 已退出；确认没有安装进程后删除 ${file} 再重试`; }
      } catch { /* An incomplete lock is not safe to steal from its writer. */ }
      throw new Error(detail, { cause: error });
    }
    const nonce = randomUUID();
    const completed: string[] = [];
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, nonce }));
      return await operation(completed);
    } catch (error) {
      const state = request ? await this.inspect(request).catch(() => undefined) : undefined;
      throw new PluginManagementOperationError(error, completed, state);
    } finally {
      await handle.close();
      const current = await readFile(file, 'utf8').catch(() => '');
      if (current === JSON.stringify({ pid: process.pid, nonce })) await unlink(file);
    }
  }

  async #pnpm(args: string[]) {
    const workspace = await access(join(this.#root, 'pnpm-workspace.yaml')).then(() => true, error => { if (notFound(error)) return false; throw error; });
    const invocation = [args[0]!, ...(workspace ? ['-w'] : []), ...args.slice(1)];
    if (this.#options.installDependencies) await this.#options.installDependencies(invocation, this.#root);
    else await execute('pnpm', invocation, { cwd: this.#root, maxBuffer: 10 * 1024 * 1024 });
  }

  async install(request: string, expectedRevision?: string, expectedProjectRevision?: string, options: PluginInstallOptions = {}) {
    if (options.saveDev && options.enable !== false) throw new Error('--save-dev cannot enable a Runtime plugin; use --no-enable or install as a production dependency');
    const spec = npmSpec(request);
    return this.#mutate(async completed => {
      const previous = await this.#assertRevision(expectedRevision, expectedProjectRevision);
      const plan = await this.planInstall(request, options);
      const existing = await this.#installed(spec.name);
      const { project: installedProject } = await this.#project();
      // An exact installed artifact can finish declaration/configuration after
      // a lost receipt without running the package manager again. Tags/ranges,
      // alternate sources and dependency-tier changes still need installation.
      // The declared range must already be the requested exact pin; otherwise
      // skipping would leave package.json at an older/looser range.
      if (options.source || options.saveDev || installedProject.dependencies?.[spec.name] !== spec.version
        || !spec.version || !existing.installed
        || existing.error || existing.version !== spec.version) {
        await this.#pnpm(['add', ...(options.saveDev ? ['-D'] : []), options.source ?? spec.spec]);
      }
      completed.push('dependency-install');
      const installed = await this.#installed(spec.name);
      if (!installed.installed) throw new Error('Package manager completed but the installed package is unavailable');
      if (installed.error) throw new Error(installed.error);
      if (options.enable !== false && installed.plugin) {
        if (options.saveDev) throw new Error('Runtime plugins must be production dependencies; use installation without --save-dev');
        if ((await this.#revisions()).revision !== previous.revision) throw new Error('Root config changed during installation');
        const target = { packageName: spec.name, instanceKey: plan.instanceKey };
        await this.#checkDependencies(target);
        const configuration = this.#configuration();
        if (!configuration) throw new Error('Missing configVersion: 2 configuration; run zhin setup');
        const currentConfig = await configuration.document.read();
        readApplicationPluginDeclaration(currentConfig.document);
        if (previous.revision && currentConfig.revision !== previous.revision) throw new Error('Root config changed during installation');
        const entries = currentConfig.document.plugins as Record<string, unknown>;
        if (Object.hasOwn(entries, target.instanceKey) && entries[target.instanceKey] !== target.packageName) throw new Error(`Plugin instanceKey collision: ${target.instanceKey}`);
        const patches: import('@zhin.js/plugin-runtime').ConfigPatch[] = [];
        if (!Object.hasOwn(entries, target.instanceKey)) patches.push({op: 'set', path: ['plugins', target.instanceKey], value: target.packageName});
        if (!Object.hasOwn(currentConfig.document, target.instanceKey)) patches.push({op: 'set', path: [target.instanceKey], value: {}});
        if (patches.length) await (await configuration.document.prepare(currentConfig, patches)).commit();
        completed.push('application-declaration', 'minimum-config');
      }

      const state = await this.inspect(spec.name);
      return Object.freeze({ plan, restartRequired: state.restartRequired, state });
    }, spec.name);
  }

  async planUninstall(request: string): Promise<PluginUninstallPlan> {
    const state = await this.inspect(request);
    const configuration = this.#configuration();
    const config = configuration ? await configuration.store.readDocument() : {};
    return { packageName: state.packageName, instanceKey: state.instanceKey, projectRevision: state.projectRevision, configurationRevision: state.revision, installed: state.installed, declared: state.declared, hasConfig: Object.hasOwn(config, state.instanceKey), restartRequired: state.declared || state.published };
  }

  async uninstall(request: string, expectedRevision?: string, expectedProjectRevision?: string, options: {removeDependency?: boolean} = {}) {
    return this.#mutate(async completed => {
      const previous = await this.#assertRevision(expectedRevision, expectedProjectRevision);
      const plan = await this.planUninstall(request);
      const otherInstances = (await this.#declaredEntries()).filter(entry => entry.package === plan.packageName && entry.instanceKey !== plan.instanceKey);
      const keepDependency = options.removeDependency === false || otherInstances.length > 0 || await this.#hasOtherPackageReference(plan.packageName, plan.instanceKey);
      if (plan.installed && !keepDependency && !plan.packageName.startsWith('./')) await this.#pnpm(['remove', plan.packageName]);
      if (plan.installed && !keepDependency && !plan.packageName.startsWith('./')) completed.push('dependency-remove');
      if ((await this.#revisions()).revision !== previous.revision) throw new Error('Root config changed during uninstall');
      const configuration = this.#configuration();
      const config = configuration ? await configuration.document.read() : undefined;
      if (!config || !configuration) throw new Error('Missing configVersion: 2 configuration');
      const declaration = readApplicationPluginDeclaration(config.document);
      const patches: import('@zhin.js/plugin-runtime').ConfigPatch[] = [];
      if (plan.declared) patches.push({op: 'remove', path: ['plugins', plan.instanceKey]});
      if (plan.hasConfig) patches.push({op: 'remove', path: [plan.instanceKey]});
      if (declaration.disabled.includes(plan.instanceKey)) patches.push({op: 'set', path: ['disable_plugins'], value: declaration.disabled.filter(key => key !== plan.instanceKey)});
      if (patches.length) await (await configuration.document.prepare(config, patches)).commit();
      completed.push('application-unmount', 'config-remove');
      return {plan, restartRequired: plan.restartRequired};
    }, request);
  }

  async #hasOtherPackageReference(packageName: string, removedKey: string): Promise<boolean> {
    const resolver = await NodePackageResolver.create(this.#root);
    const root = await resolver.root(this.#root);
    const seen = new Set<string>();
    const visit = async (pkg: ResolvedPackage, isRoot = false): Promise<boolean> => {
      if (seen.has(pkg.root)) return false;
      seen.add(pkg.root);
      if (pkg.packageJson.zhin.type !== 'plugin') return false;
      if (pkg.packageJson.zhin.features.some(item => item.package === packageName)) return true;
      if (!isRoot && [pkg.packageJson.dependencies, pkg.packageJson.optionalDependencies, pkg.packageJson.peerDependencies].some(deps => deps?.[packageName])) return true;
      const entries = isRoot ? await this.#declaredEntries() : [];
      for (const entry of entries) {
        if (isRoot && entry.instanceKey === removedKey) continue;
        if (entry.package === packageName) return true;
        try { if (await visit(await resolver.resolve(entry.package, pkg))) return true; }
        catch { return true; } // Unresolved references cannot prove dependency removal is safe.
      }
      return false;
    };
    return visit(root, true);
  }

  async planUpdate(request: string, targetVersion: string): Promise<PluginUpdatePlan> {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(targetVersion)) throw new Error('targetVersion must be an exact semver version');
    const state = await this.inspect(request);
    if (state.packageName.startsWith('./')) throw new Error('Local plugins are updated through their source files, not npm version changes');
    return { packageName: state.packageName, instanceKey: state.instanceKey, currentVersion: state.version, targetVersion, projectRevision: state.projectRevision, configurationRevision: state.revision, installed: state.installed, declared: state.declared, alreadyCurrent: state.version === targetVersion, restartRequired: state.version !== targetVersion };
  }

  async update(request: string, targetVersion: string, expectedRevision?: string, expectedProjectRevision?: string) {
    return this.#mutate(async completed => {
      const previous = await this.#assertRevision(expectedRevision, expectedProjectRevision);
      const plan = await this.planUpdate(request, targetVersion);
      if (!plan.installed || !plan.declared) throw new Error('插件必须先安装并声明才能更新');
      if (!plan.alreadyCurrent) await this.#pnpm(['add', `${plan.packageName}@${plan.targetVersion}`]);
      if (!plan.alreadyCurrent) completed.push('dependency-update');
      if ((await this.#revisions()).revision !== previous.revision) throw new Error('Root config changed during update');
      const state = await this.inspect(plan.instanceKey);
      if (state.version !== plan.targetVersion) throw new Error('Package manager did not install the requested exact version');
      if (!state.installed || !state.plugin || state.dependencies !== 'passed' || state.issues.length) throw new Error('Updated package failed plugin/dependency verification');
      return { plan, installedVersion: state.version, restartRequired: !plan.alreadyCurrent };
    }, request);
  }

  async apply(request: string, expectedProjectRevision?: string) {
    return this.#mutate(async () => {
      await this.#assertRevision(undefined, expectedProjectRevision);
      const state = await this.inspect(request);
      if (!state.declared || !state.disabled && (!state.installed || !state.plugin || state.status === 'missing-config' || state.status === 'degraded')) throw new Error('插件未通过安装、依赖和配置检查，不能应用');
      if (!this.#options.requestRestart) return { requested: false, state };
      if (!state.restartRequired) return { requested: false, state };
      // The caller receives pending-restart; only a subsequent generation can prove publication.
      await this.#options.requestRestart();
      return { requested: true, state };
    });
  }

  async verificationPlan(request: string): Promise<PluginVerificationPlan> {
    const target = await this.#resolveTarget(request);
    const installed = await this.#installed(target.packageName);
    const revisions = await this.#revisions();
    const lease = this.#options.snapshots?.acquire();
    try {
      const node = lease && [...lease.value.tree.values()].find(item => item.parent === rootPluginId() && item.instanceKey === target.instanceKey && item.packageName === (installed.pkg?.name ?? target.packageName));
      const host = node && lease?.value.resources.get(node.id)?.get(pluginVerificationToken.id) as import('@zhin.js/plugin-runtime').PluginVerificationHost | undefined;
      const checks = verificationChecks(host);
      return Object.freeze({ ...target, generation: lease?.value.generation ?? null, projectRevision: revisions.projectRevision, checkRevision: checksRevision(this.#verificationIncarnation, node?.id, checks), checks });
    } finally { lease?.release(); }
  }

  async verify(request: string, checkId: string, expectedGeneration: number | null, expectedProjectRevision: string, expectedCheckRevision: string): Promise<PluginVerificationResult> {
    const target = await this.#resolveTarget(request);
    const state = await this.inspect(request);
    const installed = await this.#installed(target.packageName);
    const lease = this.#options.snapshots?.acquire();
    try {
      const node = lease && [...lease.value.tree.values()].find(item => item.parent === rootPluginId() && item.instanceKey === target.instanceKey && item.packageName === (installed.pkg?.name ?? target.packageName));
      const host = node && lease?.value.resources.get(node.id)?.get(pluginVerificationToken.id) as import('@zhin.js/plugin-runtime').PluginVerificationHost | undefined;
      const checks = verificationChecks(host);
      if (expectedGeneration !== (lease?.value.generation ?? null) || typeof expectedProjectRevision !== 'string' || (await this.#revisions()).projectRevision !== expectedProjectRevision || checksRevision(this.#verificationIncarnation, node?.id, checks) !== expectedCheckRevision) throw new Error('Verification plan changed; refresh the check and its effects before approving again');
      const check = checks.find(item => item.id === checkId);
      if (!host || !check || !lease || state.status !== 'enabled' || state.generation !== lease.value.generation) return { ...target, checkId, generation: lease?.value.generation ?? null, current: false, status: 'not-configured', scope: null, summary: 'No applied current plugin business verification is configured', evidence: [] };
      const outcome = await host.run(checkId);
      const summaryI18n = verificationTranslations(outcome.summaryI18n, false);
      const evidenceI18n = verificationTranslations(outcome.evidenceI18n, true, outcome.evidence.length);
      const after = await this.inspect(request);
      const current = after.generation === lease.value.generation && after.status === 'enabled';
      return Object.freeze({ ...target, ...outcome,
        ...(summaryI18n ? { summaryI18n } : {}), ...(evidenceI18n ? { evidenceI18n } : {}),
        checkId, generation: lease.value.generation, current, scope: check.scope });
    } finally { lease?.release(); }
  }

}

/** Errors retain completed-stage evidence instead of pretending an unsafe rollback succeeded. */
export class PluginManagementOperationError extends Error {
  readonly completedStages: readonly string[];
  readonly state?: PluginManagementState;
  constructor(cause: unknown, completed: readonly string[], state?: PluginManagementState) {
    super(`${errorMessage(cause)}。已完成步骤: ${completed.join(', ') || '无已确认步骤'}；未回滚文件，请检查 packages status 后继续。`, { cause });
    this.name = 'PluginManagementOperationError';
    this.completedStages = Object.freeze([...completed]);
    this.state = state;
  }
}

function verificationChecks(host?: import('@zhin.js/plugin-runtime').PluginVerificationHost) {
  const checks = (host?.checks() ?? []).map(check => {
    if (!check.id || !check.title || !Array.isArray(check.effects) || !check.effects.every(effect => typeof effect === 'string') || !['local', 'platform'].includes(check.scope)) throw new Error('Invalid plugin verification descriptor');
    const titleI18n = verificationTranslations(check.titleI18n, false);
    const effectsI18n = verificationTranslations(check.effectsI18n, true, check.effects.length);
    return Object.freeze({ id: check.id, title: check.title, effects: Object.freeze([...check.effects]), scope: check.scope,
      ...(titleI18n ? { titleI18n } : {}), ...(effectsI18n ? { effectsI18n } : {}) });
  });
  if (new Set(checks.map(check => check.id)).size !== checks.length) throw new Error('Duplicate plugin verification check id');
  return Object.freeze(checks);
}
function verificationTranslations<T extends boolean>(value: unknown, list: T, expectedLength?: number): Readonly<Partial<Record<'zh-CN' | 'en', T extends true ? readonly string[] : string>>> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid plugin verification translations');
  const result: Record<string, string | readonly string[]> = {};
  for (const locale of ['zh-CN', 'en'] as const) {
    const entry = (value as Record<string, unknown>)[locale];
    if (entry === undefined) continue;
    const nonempty = (item: unknown) => typeof item === 'string' && item.trim().length > 0;
    if (list ? !Array.isArray(entry) || entry.length !== expectedLength || !entry.every(nonempty) : !nonempty(entry)) throw new Error('Invalid plugin verification translations');
    result[locale] = Array.isArray(entry) ? Object.freeze([...entry]) : entry as string;
  }
  return Object.freeze(result) as Readonly<Partial<Record<'zh-CN' | 'en', T extends true ? readonly string[] : string>>>;
}
function checksRevision(incarnation: string, owner: string | undefined, checks: readonly import('@zhin.js/plugin-runtime').PluginVerificationCheck[]) {
  return createHash('sha256').update(JSON.stringify([incarnation, owner, checks])).digest('hex');
}

function npmSpec(value: string) {
  const match = /^(?<name>(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*)(?:@(?<version>[^\s]+))?$/u.exec(value.trim());
  if (!match?.groups) throw new Error('Plugin management accepts npm package names with an optional version/tag');
  const name = match.groups.name!;
  return { name, version: match.groups.version, spec: match.groups.version ? `${name}@${match.groups.version}` : name };
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function notFound(error: unknown) { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }
