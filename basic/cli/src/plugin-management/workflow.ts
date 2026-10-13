import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify, isDeepStrictEqual } from 'node:util';
import { createConfigDocument, JsonConfigDocument } from '@zhin.js/config-file';
import { loadProjectConfig, packageToInstanceKey } from '@zhin.js/scaffold-wizard';
import { NodePackageResolver, PackageResolutionError, ProjectGraphService, primaryConfigToken, parsePluginConfigSchema, envStoreToken, runtimeEnvironmentToken, type EnvStore, type RuntimeEnvironment, type ResolvedPackage } from '@zhin.js/runtime';
import {
  pluginVerificationToken, rootPluginId, readPluginConfigurationMap,
  type SnapshotReader, type PluginNodeSnapshot,
} from '@zhin.js/plugin-runtime';
import type {
  PluginInstallPlan, PluginManagementPort, PluginManagementState,
  PluginUninstallPlan, PluginUpdatePlan, PluginVerificationResult, PluginVerificationPlan,
} from '@zhin.js/host-http';
import { ConsoleConfigurationStore } from '../plugin-runtime/console/configuration.js';
import { readPluginLifecycleState, resolvePluginLifecycleFile } from '../plugin-runtime/plugin-lifecycle-store.js';

const execute = promisify(execFile);
type Project = { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; devDependencies?: Record<string, string>; zhin?: { plugins?: { package: string; instanceKey: string }[] } };

export interface PluginManagementOptions {
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
  constructor(projectRoot: string, options: PluginManagementOptions = {}) {
    this.#root = resolve(projectRoot);
    this.#options = options;
  }

  async #project() {
    const document = new JsonConfigDocument(join(this.#root, 'package.json'));
    const source = await document.read();
    return { document, source, project: source.document as Project };
  }

  #configuration() {
    const loaded = loadProjectConfig(this.#root);
    if (loaded.status === 'missing') return undefined;
    if (loaded.status !== 'loaded' || !loaded.configPath) throw new Error(loaded.message ?? 'Root configuration must use YAML or JSON');
    const document = createConfigDocument(loaded.configPath);
    return { document, store: this.#configurationStore(document) };
  }

  #configurationStore(document: import('@zhin.js/config-file').ConfigFileDocument) {
    return new ConsoleConfigurationStore({ projectRoot: this.#root, document,
      environmentName: () => {
        const lease = this.#options.snapshots?.acquire();
        try { return (lease?.value.resources.get(rootPluginId())?.get(runtimeEnvironmentToken.id) as RuntimeEnvironment | undefined)?.name ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development'); }
        finally { lease?.release(); }
      },
      environmentForPlugin: instanceKey => {
        const lease = this.#options.snapshots?.acquire();
        try {
          const node = [...(lease?.value.tree.values() ?? [])].find(item => item.parent === rootPluginId() && item.instanceKey === instanceKey);
          return node ? lease?.value.resources.get(node.id)?.get(envStoreToken.id) as EnvStore | undefined : undefined;
        } finally { lease?.release(); }
      },
      configDeclarations: async () => {
        const lease = this.#options.snapshots?.acquire();
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

  async #resolveTarget(request: string) {
    const { project } = await this.#project();
    const entries = project.zhin?.plugins ?? [];
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

  async #checkDependencies(candidate?: { packageName: string; instanceKey: string }) {
    const resolver = await NodePackageResolver.create(this.#root);
    const root = await resolver.root(this.#root);
    if (root.packageJson.zhin.type !== 'plugin') throw new Error('Project root is not a Plugin');
    const mounted = candidate && !root.packageJson.zhin.plugins.some(entry => entry.instanceKey === candidate.instanceKey)
      ? Object.freeze({ ...root, packageJson: { ...root.packageJson, zhin: { ...root.packageJson.zhin, plugins: [...root.packageJson.zhin.plugins, { package: candidate.packageName, instanceKey: candidate.instanceKey }] } } }) as ResolvedPackage
      : root;
    const lifecycle = await readPluginLifecycleState(this.#options.lifecycleFile ?? resolvePluginLifecycleFile(this.#root));
    await new ProjectGraphService({
      root: async () => mounted,
      resolve: (request, from) => resolver.resolve(request, from),
      workspacePackages: () => resolver.workspacePackages(),
    }, { disabledPluginInstanceKeys: lifecycle.disabled }).inspect(this.#root);
  }

  async #revisions() {
    const { source } = await this.#project();
    const config = this.#configuration();
    const revision = config ? (await config.document.read()).revision : null;
    return { revision, projectRevision: createHash('sha256').update(JSON.stringify([source.revision, revision])).digest('hex') };
  }

  async inspect(request: string): Promise<PluginManagementState> {
    const target = await this.#resolveTarget(request);
    const { project } = await this.#project();
    const installed = await this.#installed(target.packageName);
    const declared = project.zhin?.plugins?.some(entry => entry.package === target.packageName && entry.instanceKey === target.instanceKey) ?? false;
    const configuration = this.#configuration();
    const config = configuration ? await configuration.store.readDocument() : {};
    const issues: string[] = installed.error ? [installed.error] : [];
    if (declared && !installed.installed) issues.push('Declared plugin package is not installed');
    let dependencies: PluginManagementState['dependencies'] = 'unchecked';
    let validation: PluginManagementState['validation'] = null;
    if (installed.plugin && declared) {
      try { await this.#checkDependencies(); dependencies = 'passed'; }
      catch (error) { dependencies = 'failed'; issues.push(errorMessage(error)); }
      const validator = configuration?.store ?? this.#configurationStore(createConfigDocument(join(this.#root, 'zhin.config.yml')));
      validation = await validator.validatePluginConfig(target.instanceKey, config[target.instanceKey] ?? {});
    }
    const lifecycle = await readPluginLifecycleState(this.#options.lifecycleFile ?? resolvePluginLifecycleFile(this.#root));
    const disabled = lifecycle.disabled.includes(target.instanceKey);
    const lease = this.#options.snapshots?.acquire();
    let node: PluginNodeSnapshot | undefined;
    let generation: number | null = null;
    let published = false;
    let readiness: PluginManagementState['readiness'] = 'unknown';
    let verification: PluginManagementState['verification'] = 'not-configured';
    try {
      generation = lease?.value.generation ?? null;
      node = lease && [...lease.value.tree.values()].find(item => item.parent === rootPluginId() && item.instanceKey === target.instanceKey && item.packageName === (installed.pkg?.name ?? target.packageName));
      if (node && lease) {
        const owner = node.id;
        const primary = lease.value.resources.get(rootPluginId())?.get(primaryConfigToken.id) as import('@zhin.js/runtime').PrimaryConfig | undefined;
        const applied = primary ? readPluginConfigurationMap(primary.document) : undefined;
        const candidate = node.configSchema ? parsePluginConfigSchema(node.configSchema, config[target.instanceKey]).value : config[target.instanceKey] ?? {};
        published = Boolean(installed.version && node.packageVersion === installed.version && applied && isDeepStrictEqual(applied[target.instanceKey] ?? {}, candidate));
        if (published && ![...lease.value.capabilities.values()].some(slot => slot.owner === owner && String(slot.feature) === 'zhin.adapter')) readiness = 'ready';
        if (lease.value.resources.get(node.id)?.has(pluginVerificationToken.id)) verification = 'available';
      }
    } finally { lease?.release(); }
    // Published raw config is read from this generation's primary authority, not the disk version or expanded defaults.
    const missingConfig = declared && (validation?.valid === false || Boolean(validation?.missingEnv.length));
    const restartRequired = declared && (disabled ? Boolean(node) : !published || dependencies !== 'passed');
    const status: PluginManagementState['status'] = issues.length ? 'degraded'
      : missingConfig ? 'missing-config'
      : published && !disabled ? 'enabled'
      : restartRequired ? 'pending-restart'
      : declared ? 'declared' : installed.installed ? 'installed' : 'not-installed';
    return Object.freeze({ ...target, ...await this.#revisions(), installed: installed.installed, plugin: installed.plugin, version: installed.version, declared, status, dependencies, validation, generation, published, readiness, restartRequired, disabled, issues: Object.freeze(issues), verification });
  }

  async planInstall(request: string, options: Pick<PluginInstallOptions, 'enable'> = {}): Promise<PluginInstallPlan> {
    const spec = npmSpec(request);
    const state = await this.inspect(spec.name);
    const config = this.#configuration();
    const document = config ? await config.store.readDocument() : {};
    const enable = options.enable !== false;
    return Object.freeze({ packageName: spec.name, instanceKey: state.instanceKey, projectRevision: state.projectRevision, configurationRevision: state.revision, alreadyInstalled: state.installed, alreadyDeclared: state.declared, restartRequired: enable ? !state.declared || state.restartRequired : state.declared && state.restartRequired, changes: Object.freeze({ packageManifest: !enable || state.declared ? 'unchanged' : 'add-plugin', config: !enable ? 'unchanged' : !config ? 'schema-required' : Object.hasOwn(document, state.instanceKey) ? 'unchanged' : 'create-entry' }), warnings: Object.freeze([...state.issues, ...(enable && !config ? ['Root YAML/JSON 配置文件缺失，请先运行 zhin setup'] : []), '安装/声明不表示业务验证通过；配置就绪后显式 apply 和 verify']) });
  }

  async #assertRevision(expectedRevision?: string, expectedProjectRevision?: string) {
    const current = await this.#revisions();
    if (expectedRevision !== undefined && current.revision !== expectedRevision || expectedProjectRevision !== undefined && current.projectRevision !== expectedProjectRevision) throw new Error('项目或配置已被其他会话修改，请刷新后重试');
    return current;
  }

  async #mutate<T>(operation: (completed: string[]) => Promise<T>, request?: string): Promise<T> {
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
      await this.#pnpm(['add', ...(options.saveDev ? ['-D'] : []), options.source ?? spec.spec]);
      completed.push('dependency-install');
      const installed = await this.#installed(spec.name);
      if (!installed.installed) throw new Error('Package manager completed but the installed package is unavailable');
      if (installed.error) throw new Error(installed.error);
      if (options.enable !== false && installed.plugin) {
        if (options.saveDev) throw new Error('Runtime plugins must be production dependencies; use installation without --save-dev');
        if ((await this.#revisions()).revision !== previous.revision) throw new Error('Root config changed during installation');
        const target = { packageName: spec.name, instanceKey: plan.instanceKey };
        await this.#checkDependencies(target);
        const { document, source, project } = await this.#project();
        const entries = project.zhin?.plugins ?? [];
        if (entries.some(entry => entry.instanceKey === target.instanceKey && entry.package !== target.packageName)) throw new Error(`Plugin instanceKey collision: ${target.instanceKey}`);
        if (!entries.some(entry => entry.instanceKey === target.instanceKey && entry.package === target.packageName)) {
          await (await document.prepare(source, [{ op: 'set', path: ['zhin', 'plugins'], value: [...entries, { package: target.packageName, instanceKey: target.instanceKey }] }])).commit();
        }
        completed.push('manifest-declaration');
        const configuration = this.#configuration();
        if (configuration) {
          const current = await configuration.document.read();
          if (previous.revision && current.revision !== previous.revision) throw new Error('Root config changed during installation');
          const plugins = current.document.plugins as Record<string, unknown> | undefined;
          if (!plugins || !Object.hasOwn(plugins, target.instanceKey)) await (await configuration.document.prepare(current, [{ op: 'set', path: ['plugins', target.instanceKey], value: {} }])).commit();
          completed.push('minimum-config');
        }
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

  async uninstall(request: string, expectedRevision?: string, expectedProjectRevision?: string) {
    return this.#mutate(async completed => {
      const previous = await this.#assertRevision(expectedRevision, expectedProjectRevision);
      const plan = await this.planUninstall(request);
      const { project } = await this.#project();
      const otherInstances = project.zhin?.plugins?.filter(entry => entry.package === plan.packageName && entry.instanceKey !== plan.instanceKey) ?? [];
      if (plan.installed && !otherInstances.length && !plan.packageName.startsWith('./')) await this.#pnpm(['remove', plan.packageName]);
      if (plan.installed && !otherInstances.length && !plan.packageName.startsWith('./')) completed.push('dependency-remove');
      if ((await this.#revisions()).revision !== previous.revision) throw new Error('Root config changed during uninstall');
      const { document, source, project: current } = await this.#project();
      if (plan.declared) await (await document.prepare(source, [{ op: 'set', path: ['zhin', 'plugins'], value: (current.zhin?.plugins ?? []).filter(entry => entry.package !== plan.packageName || entry.instanceKey !== plan.instanceKey) }])).commit();
      const configuration = this.#configuration();
      if (configuration && plan.hasConfig) {
        const config = await configuration.document.read();
        if (config.revision !== previous.revision) throw new Error('Root config changed during uninstall');
        await (await configuration.document.prepare(config, [{ op: 'remove', path: ['plugins', plan.instanceKey] }])).commit();
      }
      completed.push('manifest-unmount', 'config-remove');
      return { plan, restartRequired: plan.restartRequired };
    }, request);
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
      return Object.freeze({ ...target, generation: lease?.value.generation ?? null, projectRevision: revisions.projectRevision, checkRevision: checksRevision(node?.id, checks), checks });
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
      if (expectedGeneration !== (lease?.value.generation ?? null) || typeof expectedProjectRevision !== 'string' || (await this.#revisions()).projectRevision !== expectedProjectRevision || checksRevision(node?.id, checks) !== expectedCheckRevision) throw new Error('Verification plan changed; refresh the check and its effects before approving again');
      const check = checks.find(item => item.id === checkId);
      if (!host || !check || !lease || state.status !== 'enabled' || state.generation !== lease.value.generation) return { ...target, checkId, generation: lease?.value.generation ?? null, current: false, status: 'not-configured', scope: null, summary: 'No applied current plugin business verification is configured', evidence: [] };
      const outcome = await host.run(checkId);
      const after = await this.inspect(request);
      const current = after.generation === lease.value.generation && after.status === 'enabled';
      return Object.freeze({ ...target, ...outcome, checkId, generation: lease.value.generation, current, scope: check.scope });
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
    return Object.freeze({ id: check.id, title: check.title, effects: Object.freeze([...check.effects]), scope: check.scope });
  });
  if (new Set(checks.map(check => check.id)).size !== checks.length) throw new Error('Duplicate plugin verification check id');
  return Object.freeze(checks);
}
function checksRevision(owner: string | undefined, checks: readonly import('@zhin.js/plugin-runtime').PluginVerificationCheck[]) {
  return createHash('sha256').update(JSON.stringify([owner, checks])).digest('hex');
}

function npmSpec(value: string) {
  const match = /^(?<name>(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*)(?:@(?<version>[^\s]+))?$/u.exec(value.trim());
  if (!match?.groups) throw new Error('Plugin management accepts npm package names with an optional version/tag');
  const name = match.groups.name!;
  return { name, spec: match.groups.version ? `${name}@${match.groups.version}` : name };
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function notFound(error: unknown) { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }
