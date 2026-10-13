import { Command } from 'commander';
import { formatCompact } from '@zhin.js/logger';
import { logger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import { execFileSync } from 'node:child_process';
import { PluginManagementWorkflow } from '../plugin-management/workflow.js';
import {
  applyProjectConfigPlan,
  createProjectConfigPlan,
  loadProjectConfig,
  mergePluginManifestIntoPackageJson,
  packageToInstanceKey,
  renderProjectConfigPatch,
} from '@zhin.js/scaffold-wizard';

interface InstallOptions {
  save?: boolean;
  saveDev?: boolean;
  global?: boolean;
  enable?: boolean;
  dryRun?: boolean;
}

interface EnablePluginResult {
  status: 'enabled' | 'already-enabled' | 'missing-config' | 'unsupported-config';
  configFile?: string;
  pluginName?: string;
  message: string;
  patch?: string;
}

/**
 * 安装插件的核心逻辑
 */
async function installPluginAction(plugin: string, options: InstallOptions) {
  try {
    let pluginToInstall = plugin;

    // 如果没有指定插件，交互式输入
    if (!pluginToInstall) {
      const { input } = await inquirer.prompt([
        {
          type: 'input',
          name: 'input',
          message: '请输入插件名称或 git 地址:',
          validate: (input: string) => {
            if (!input.trim()) {
              return '插件名称或地址不能为空';
            }
            return true;
          }
        }
      ]);
      pluginToInstall = input;
    }

    // 判断插件类型
    const pluginType = detectPluginType(pluginToInstall);
    
    logger.info(formatCompact( { cmd: 'install', op: 'detect', type: pluginType }));
    logger.info(formatCompact( { cmd: 'install', op: 'install', package: pluginToInstall }));
    logger.log('');

    // 构建安装命令
    const installArgs = buildInstallArgs(pluginToInstall, pluginType, options);
    
    logger.log(`执行命令: pnpm ${installArgs.join(' ')}`);
    logger.log('');

    const pluginName = resolvePluginNameForEnable(pluginToInstall, pluginType, process.cwd());
    const shouldEnable = options.enable !== false && !options.global;
    const enablePreview = shouldEnable && pluginName
      ? previewEnablePlugin(process.cwd(), pluginName)
      : undefined;

    if (enablePreview?.status === 'unsupported-config') {
      throw new Error(enablePreview.message);
    }

    if (options.dryRun) {
      logger.log('🧪 dry-run：不会安装依赖，也不会修改配置。');
      logger.log(`将执行: pnpm ${installArgs.join(' ')}`);
      if (shouldEnable && pluginName && enablePreview) {
        logger.log(`将启用: ${enablePreview.message}`);
        logger.log(`将挂载: package.json 的 zhin.plugins 清单添加 ${pluginName}（instanceKey: ${packageToInstanceKey(pluginName)}）`);
        if (enablePreview.patch) {
          logger.log('');
          logger.log(enablePreview.patch);
        }
      }
      return;
    }

    if (options.global) {
      execFileSync('pnpm', installArgs, { cwd: process.cwd(), stdio: 'inherit' });
      logger.success('✓ 全局依赖安装完成（未挂载到项目 Runtime）');
      return;
    }
    if (!pluginName) throw new Error('无法确定包名，请使用 npm 包名或带 package.json 的本地目录');
    const result = await new PluginManagementWorkflow(process.cwd()).install(
      pluginType === 'npm' && !pluginToInstall.startsWith('.') && !pluginToInstall.startsWith('file:')
        ? pluginToInstall : pluginName,
      undefined, undefined,
      { enable: shouldEnable, saveDev: options.saveDev, source: installArgs.at(-1) },
    );
    logger.success(`✓ 依赖安装完成：${result.state.packageName}@${result.state.version ?? 'unknown'}`);
    logger.log(`插件状态: ${result.state.status}；功能验证: ${result.state.verification}`);
    if (!result.state.plugin) logger.log('该包是普通依赖，不会挂载到 Plugin Runtime。');
    if (result.state.status === 'missing-config') logger.log('运行 zhin setup 补齐配置和环境变量，再应用。');
    if (result.restartRequired) logger.log('配置就绪后启动/重启 Host，再用 packages status 检查当前 generation。');

  } catch (error: unknown) {
    logger.error(`安装插件失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

export const installCommand = new Command('install')
  .description('安装插件（npm 包或 git 仓库）')
  .argument('[plugin]', '插件名称或 git 地址')
  .option('-S, --save', '安装到 dependencies（默认）', true)
  .option('-D, --save-dev', '安装到 devDependencies', false)
  .option('-g, --global', '全局安装', false)
  .option('--no-enable', '只安装依赖，不自动写入 zhin.config')
  .option('--dry-run', '打印将要执行的安装和配置改动，不写入文件')
  .action(installPluginAction);

// 别名命令
export const addCommand = new Command('add')
  .description('安装插件（install 的别名）')
  .argument('[plugin]', '插件名称或 git 地址')
  .option('-S, --save', '安装到 dependencies（默认）', true)
  .option('-D, --save-dev', '安装到 devDependencies', false)
  .option('-g, --global', '全局安装', false)
  .option('--no-enable', '只安装依赖，不自动写入 zhin.config')
  .option('--dry-run', '打印将要执行的安装和配置改动，不写入文件')
  .action(installPluginAction);

/**
 * 检测插件类型
 */
export function detectPluginType(plugin: string): 'npm' | 'git' | 'github' | 'gitlab' | 'bitbucket' {
  // Git 协议
  if (plugin.startsWith('git://') || plugin.startsWith('git+')) {
    return 'git';
  }

  // HTTPS/SSH git 地址
  if (plugin.includes('github.com') || plugin.includes('gitlab.com') || plugin.includes('bitbucket.org')) {
    if (plugin.includes('github.com')) return 'github';
    if (plugin.includes('gitlab.com')) return 'gitlab';
    if (plugin.includes('bitbucket.org')) return 'bitbucket';
    return 'git';
  }

  // GitHub 简写 (user/repo)
  if (/^[\w-]+\/[\w-]+$/.test(plugin)) {
    return 'github';
  }

  // 默认为 npm 包
  return 'npm';
}

/**
 * 检查是否在 workspace root
 */
function isWorkspaceRoot(): boolean {
  try {
    const cwd = process.cwd();
    const pkgJsonPath = path.join(cwd, 'package.json');
    const workspacePath = path.join(cwd, 'pnpm-workspace.yaml');
    
    // 检查是否存在 pnpm-workspace.yaml
    if (!fs.existsSync(workspacePath)) {
      return false;
    }
    
    // 检查 package.json 是否存在
    if (!fs.existsSync(pkgJsonPath)) {
      return false;
    }
    
    const pkgJson = fs.readJsonSync(pkgJsonPath);
    
    // 如果 package.json 有 workspaces 字段或者存在 pnpm-workspace.yaml，
    // 并且 package.json 中没有明确表示这是一个子包（没有 workspace:* 依赖），
    // 则认为当前在 workspace root
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 构建安装命令参数数组（不包含 pnpm 本身）
 */
export function buildInstallArgs(plugin: string, type: string, options: InstallOptions): string[] {
  const parts = ['add'];

  // 添加保存选项
  if (options.saveDev) {
    parts.push('-D');
  }

  if (options.global) {
    parts.push('-g');
  } else if (isWorkspaceRoot()) {
    // 如果在 workspace root 且不是全局安装，添加 -w 标志
    parts.push('-w');
  }

  // 处理不同类型的插件
  let packageSpec = plugin;

  switch (type) {
    case 'github':
      // 如果是简写形式，转换为完整 GitHub URL
      if (/^[\w-]+\/[\w-]+$/.test(plugin)) {
        packageSpec = `github:${plugin}`;
      } else if (!plugin.startsWith('git+') && !plugin.startsWith('https://')) {
        packageSpec = `git+${plugin}`;
      }
      break;

    case 'gitlab':
      if (!plugin.startsWith('git+') && !plugin.startsWith('https://')) {
        packageSpec = `git+${plugin}`;
      }
      break;

    case 'bitbucket':
      if (!plugin.startsWith('git+') && !plugin.startsWith('https://')) {
        packageSpec = `git+${plugin}`;
      }
      break;

    case 'git':
      // Git URL 直接使用
      break;

    case 'npm':
    default:
      // npm 包名直接使用
      break;
  }

  parts.push(packageSpec);

  return parts;
}

/**
 * 提取插件名称
 */
export function extractPluginName(plugin: string, type: string): string | null {
  switch (type) {
    case 'npm':
      return stripNpmVersion(plugin);

    case 'github':
    case 'gitlab':
    case 'bitbucket':
      // 从 git URL 中提取仓库名
      const repoMatch = plugin.match(/\/([^/]+?)(\.git)?$/);
      if (repoMatch) {
        return repoMatch[1];
      }
      // 简写形式 user/repo
      if (/^[\w-]+\/([\w-]+)$/.test(plugin)) {
        return plugin.split('/')[1];
      }
      return null;

    case 'git':
      // 从 git URL 中提取仓库名
      const gitMatch = plugin.match(/\/([^/]+?)(\.git)?$/);
      if (gitMatch) {
        return gitMatch[1];
      }
      return null;

    default:
      return null;
  }
}

export function resolvePluginNameForEnable(plugin: string, type: string, cwd: string): string | null {
  if (type === 'npm') {
    const localName = readLocalPackageName(plugin, cwd);
    if (localName) return localName;
  }
  return extractPluginName(plugin, type);
}

export function stripNpmVersion(spec: string): string {
  const normalized = spec.replace(/^npm:/, '');
  if (normalized.startsWith('@')) {
    const slashIndex = normalized.indexOf('/');
    if (slashIndex < 0) return normalized;
    const versionIndex = normalized.indexOf('@', slashIndex + 1);
    return versionIndex > 0 ? normalized.slice(0, versionIndex) : normalized;
  }
  const versionIndex = normalized.indexOf('@');
  return versionIndex > 0 ? normalized.slice(0, versionIndex) : normalized;
}

function readLocalPackageName(spec: string, cwd: string): string | null {
  const localSpec = spec.startsWith('file:') ? spec.slice('file:'.length) : spec;
  if (!localSpec.startsWith('.') && !path.isAbsolute(localSpec)) return null;

  const packageDir = path.resolve(cwd, localSpec);
  const packageJsonPath = path.join(packageDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = fs.readJsonSync(packageJsonPath) as { name?: unknown };
      if (typeof pkg.name === 'string' && pkg.name.trim().length > 0) {
        return pkg.name;
      }
    } catch {
      return path.basename(packageDir);
    }
  }
  return path.basename(packageDir);
}

export function previewEnablePlugin(cwd: string, pluginName: string): EnablePluginResult {
  const loaded = loadProjectConfig(cwd);
  if (loaded.status === 'missing') {
    return {
      status: 'missing-config',
      pluginName,
      message: `未找到 Root YAML/JSON 配置文件；将提示手动添加 ${pluginName}`,
    };
  }
  if (loaded.status !== 'loaded') {
    return {
      status: 'unsupported-config',
      configFile: loaded.configPath,
      pluginName,
      message: loaded.message
        ? `${loaded.message}；无法自动启用 ${pluginName}`
        : `${loaded.relativePath ?? 'zhin.config'} 暂不支持自动写入；无法自动启用 ${pluginName}`,
    };
  }

  const plan = createProjectConfigPlan({ loaded, enablePlugins: [pluginName] });
  const alreadyEnabled = !plan.changed;
  return {
    status: alreadyEnabled ? 'already-enabled' : 'enabled',
    configFile: loaded.configPath,
    pluginName,
    message: alreadyEnabled
      ? `${pluginName} 已在 ${loaded.relativePath} 中启用`
      : `将在 ${loaded.relativePath} 的 plugins 中添加 ${pluginName}`,
    patch: alreadyEnabled ? undefined : renderProjectConfigPatch(plan),
  };
}

export async function enablePluginInProjectConfig(cwd: string, pluginName: string): Promise<EnablePluginResult> {
  const preview = previewEnablePlugin(cwd, pluginName);
  if (preview.status !== 'enabled' || !preview.configFile) return preview;

  const loaded = loadProjectConfig(cwd, preview.configFile);
  const plan = createProjectConfigPlan({ loaded, enablePlugins: [pluginName] });
  await applyProjectConfigPlan(plan);

  return {
    ...preview,
    message: `已在 ${path.basename(preview.configFile)} 中启用 ${pluginName}`,
  };
}
