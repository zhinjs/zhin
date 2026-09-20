import { readFile, writeFile, access, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { packageToInstanceKey } from '@zhin.js/scaffold-wizard';
import type {
  PluginInstallPlan,
  PluginManagementPort,
  PluginUninstallPlan,
  PluginUpdatePlan,
} from '@zhin.js/host-http';
import {
  applyProjectConfigPlan,
  createProjectConfigPlan,
  loadProjectConfig,
  mergePluginManifestIntoPackageJson,
} from '@zhin.js/scaffold-wizard';
import { previewEnablePlugin } from '../../commands/install.js';

const execFileAsync = promisify(execFile);

type ProjectPackageJson = {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly zhin?: {
    readonly plugins?: readonly (string | { readonly package?: string; readonly instanceKey?: string })[];
  };
};

type DeclaredPlugin = NonNullable<NonNullable<ProjectPackageJson['zhin']>['plugins']>[number];

function isDeclared(
  plugins: readonly DeclaredPlugin[] | undefined,
  packageName: string,
  instanceKey: string,
): boolean {
  if (!Array.isArray(plugins)) return false;
  return plugins.some((entry) => (
    typeof entry === 'string'
      ? entry === packageName || entry === instanceKey
      : entry?.package === packageName || entry?.instanceKey === instanceKey
  ));
}

async function readProjectPackage(projectRoot: string): Promise<ProjectPackageJson> {
  const source = await readFile(join(projectRoot, 'package.json'), 'utf8');
  return JSON.parse(source) as ProjectPackageJson;
}

export function createPluginManagementPort(
  projectRoot: string,
  options: {
    readonly readConfigRevision?: () => Promise<string>;
    readonly readConfigDocument?: () => Promise<Record<string, unknown>>;
    readonly removeConfigKey?: (instanceKey: string) => Promise<unknown>;
  } = {},
): PluginManagementPort {
  return {
    async planInstall(packageName: string): Promise<PluginInstallPlan> {
      const normalized = packageName.trim();
      if (!normalized) throw new Error('packageName is required');
      if (!/^(?:@[^/]+\/)?[^/]+$/u.test(normalized)
        || normalized.startsWith('.')
        || normalized.startsWith('git')
        || normalized.includes('://')) {
        throw new Error('Console install planning currently accepts npm package names only');
      }
      const instanceKey = packageToInstanceKey(normalized);
      const project = await readProjectPackage(projectRoot);
      const configPreview = previewEnablePlugin(projectRoot, normalized);
      const installed = Boolean(
        project.dependencies?.[normalized] || project.devDependencies?.[normalized],
      );
      const declared = isDeclared(project.zhin?.plugins, normalized, instanceKey);
      const warnings: string[] = [];
      if (!installed) warnings.push('插件尚未安装，需要写入 package.json 并安装依赖');
      if (!declared) warnings.push('插件尚未挂载到 zhin.plugins，安装后需要重启 Host');
      return Object.freeze({
        packageName: normalized,
        instanceKey,
        alreadyDeclared: declared,
        alreadyInstalled: installed,
        restartRequired: !declared,
        changes: Object.freeze({
          packageManifest: declared ? 'unchanged' : 'add-plugin',
          config: configPreview.status === 'enabled'
            ? 'create-entry'
            : configPreview.status === 'unsupported-config'
              ? 'schema-required'
              : 'unchanged',
        }),
        warnings: Object.freeze(warnings),
      });
    },
    async install(packageName: string, expectedRevision?: string) {
      if (expectedRevision && options.readConfigRevision) {
        const actualRevision = await options.readConfigRevision();
        if (actualRevision !== expectedRevision) {
          throw new Error('配置已被其他 Console 会话修改，请刷新后重试');
        }
      }
      const plan = await this.planInstall(packageName);
      const manifestFiles = ['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'];
      const manifestBefore = new Map<string, string | undefined>();
      for (const file of manifestFiles) {
        manifestBefore.set(file, await readOptionalFile(join(projectRoot, file)));
      }
      const preview = previewEnablePlugin(projectRoot, plan.packageName);
      const configFile = preview.configFile;
      const configBefore = configFile ? await readFile(configFile, 'utf8') : undefined;
      try {
        const args = ['add', ...(await fileExists(join(projectRoot, 'pnpm-workspace.yaml')) ? ['-w'] : []), plan.packageName];
        await execFileAsync('pnpm', args, { cwd: projectRoot });
        await mergePluginManifestIntoPackageJson(projectRoot, [{
          package: plan.packageName,
          instanceKey: plan.instanceKey,
        }]);
        if (preview.status === 'unsupported-config') throw new Error(preview.message);
        if (preview.status === 'enabled' && preview.configFile) {
          const loaded = loadProjectConfig(projectRoot, preview.configFile);
          await applyProjectConfigPlan(createProjectConfigPlan({
            loaded,
            enablePlugins: [plan.packageName],
          }));
        }
        return Object.freeze({ plan, restartRequired: true });
      } catch (error) {
        await restoreFiles(projectRoot, manifestBefore);
        if (configFile && configBefore !== undefined) await writeFile(configFile, configBefore, 'utf8');
        throw error;
      }
    },
    async planUninstall(packageName: string): Promise<PluginUninstallPlan> {
      const project = await readProjectPackage(projectRoot);
      const requested = packageName.trim();
      const declaredEntry = project.zhin?.plugins?.find((entry) => (
        typeof entry === 'string'
          ? entry === requested
          : entry.package === requested || entry.instanceKey === requested
      ));
      const resolvedPackageName = typeof declaredEntry === 'object' && declaredEntry?.package
        ? declaredEntry.package
        : requested;
      const installPlan = await this.planInstall(resolvedPackageName);
      const config = options.readConfigDocument ? await options.readConfigDocument() : {};
      return Object.freeze({
        packageName: installPlan.packageName,
        instanceKey: installPlan.instanceKey,
        installed: installPlan.alreadyInstalled,
        declared: installPlan.alreadyDeclared,
        hasConfig: Object.prototype.hasOwnProperty.call(config, installPlan.instanceKey)
          || Object.prototype.hasOwnProperty.call(config, installPlan.packageName),
        restartRequired: installPlan.alreadyDeclared,
      });
    },
    async uninstall(packageName: string, expectedRevision?: string) {
      if (expectedRevision && options.readConfigRevision) {
        const actualRevision = await options.readConfigRevision();
        if (actualRevision !== expectedRevision) {
          throw new Error('配置已被其他 Console 会话修改，请刷新后重试');
        }
      }
      const plan = await this.planUninstall!(packageName);
      const manifestFiles = ['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'];
      const manifestBefore = new Map<string, string | undefined>();
      for (const file of manifestFiles) {
        manifestBefore.set(file, await readOptionalFile(join(projectRoot, file)));
      }
      try {
        if (plan.installed) {
          const args = ['remove', ...(await fileExists(join(projectRoot, 'pnpm-workspace.yaml')) ? ['-w'] : []), plan.packageName];
          await execFileAsync('pnpm', args, { cwd: projectRoot });
        }
        const packageFile = join(projectRoot, 'package.json');
        const project = JSON.parse(await readFile(packageFile, 'utf8')) as ProjectPackageJson & {
          zhin?: { plugins?: DeclaredPlugin[] };
        };
        if (Array.isArray(project.zhin?.plugins)) {
          project.zhin.plugins = project.zhin.plugins.filter((entry) => (
            typeof entry === 'string'
              ? entry !== plan.packageName && entry !== plan.instanceKey
              : entry.package !== plan.packageName && entry.instanceKey !== plan.instanceKey
          ));
          await writeFile(packageFile, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
        }
        if (plan.hasConfig && options.removeConfigKey) {
          await options.removeConfigKey(plan.instanceKey);
        }
        return Object.freeze({ plan, restartRequired: plan.restartRequired });
      } catch (error) {
        await restoreFiles(projectRoot, manifestBefore);
        throw error;
      }
    },
    async planUpdate(packageName: string, targetVersion: string): Promise<PluginUpdatePlan> {
      const target = targetVersion.trim();
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(target)) {
        throw new Error('targetVersion must be an exact semver version');
      }
      const installPlan = await this.planInstall(packageName);
      const currentVersion = await readInstalledVersion(projectRoot, installPlan.packageName);
      return Object.freeze({
        packageName: installPlan.packageName,
        instanceKey: installPlan.instanceKey,
        currentVersion,
        targetVersion: target,
        installed: installPlan.alreadyInstalled,
        declared: installPlan.alreadyDeclared,
        alreadyCurrent: currentVersion === target,
        restartRequired: currentVersion !== target,
      });
    },
    async update(packageName: string, targetVersion: string, expectedRevision?: string) {
      if (expectedRevision && options.readConfigRevision) {
        const actualRevision = await options.readConfigRevision();
        if (actualRevision !== expectedRevision) {
          throw new Error('配置已被其他 Console 会话修改，请刷新后重试');
        }
      }
      const plan = await this.planUpdate!(packageName, targetVersion);
      if (!plan.installed || !plan.declared) {
        throw new Error('插件必须先安装并挂载后才能更新');
      }
      if (plan.alreadyCurrent) {
        return Object.freeze({
          plan,
          installedVersion: plan.targetVersion,
          restartRequired: false,
        });
      }
      const manifestFiles = ['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'];
      const manifestBefore = new Map<string, string | undefined>();
      for (const file of manifestFiles) {
        manifestBefore.set(file, await readOptionalFile(join(projectRoot, file)));
      }
      try {
        const args = [
          'add',
          ...(await fileExists(join(projectRoot, 'pnpm-workspace.yaml')) ? ['-w'] : []),
          `${plan.packageName}@${plan.targetVersion}`,
        ];
        await execFileAsync('pnpm', args, { cwd: projectRoot });
        const installedVersion = await readInstalledVersion(projectRoot, plan.packageName);
        if (installedVersion !== plan.targetVersion) {
          throw new Error(`更新校验失败：期望 ${plan.targetVersion}，实际 ${installedVersion ?? 'unknown'}`);
        }
        return Object.freeze({ plan, installedVersion, restartRequired: true });
      } catch (error) {
        await restoreFiles(projectRoot, manifestBefore);
        throw error;
      }
    },
  };
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readOptionalFile(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

async function restoreFiles(
  projectRoot: string,
  snapshot: ReadonlyMap<string, string | undefined>,
): Promise<void> {
  for (const [file, content] of snapshot) {
    const target = join(projectRoot, file);
    if (content !== undefined) {
      await writeFile(target, content, 'utf8');
    } else if (await fileExists(target)) {
      await unlink(target);
    }
  }
}

async function readInstalledVersion(projectRoot: string, packageName: string): Promise<string | null> {
  try {
    const manifest = JSON.parse(
      await readFile(join(projectRoot, 'node_modules', packageName, 'package.json'), 'utf8'),
    ) as { version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}
