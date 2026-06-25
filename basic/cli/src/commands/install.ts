import { Command } from 'commander';
import { formatCompact } from '@zhin.js/logger';
import { logger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import { execFileSync } from 'node:child_process';
import yaml from 'yaml';

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
}

const CONFIG_CANDIDATES = ['zhin.config.yml', 'zhin.config.yaml', 'zhin.config.json'];

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

    if (options.dryRun) {
      logger.log('🧪 dry-run：不会安装依赖，也不会修改配置。');
      logger.log(`将执行: pnpm ${installArgs.join(' ')}`);
      if (shouldEnable && pluginName) {
        const preview = previewEnablePlugin(process.cwd(), pluginName);
        logger.log(`将启用: ${preview.message}`);
      }
      return;
    }

    // 执行安装（使用 execFileSync 防止 shell 注入）
    try {
      execFileSync('pnpm', installArgs, {
        cwd: process.cwd(),
        stdio: 'inherit'
      });

      logger.success('✓ 插件安装成功！');
      logger.log('');

      // 如果是 git 插件，提供额外说明
      if (pluginType === 'git') {
        logger.log('📝 Git 插件已安装到 node_modules/');
        logger.log('');
      }

      if (shouldEnable && pluginName) {
        const enableResult = await enablePluginInProjectConfig(process.cwd(), pluginName);
        logger.log(`🔌 ${enableResult.message}`);
        if (enableResult.status === 'missing-config' || enableResult.status === 'unsupported-config') {
          logger.log('可手动添加到 zhin.config.yml:');
          logger.log('plugins:');
          logger.log(`  - "${pluginName}"`);
        }
        if (pluginName.startsWith('@zhin.js/adapter-') && pluginName !== '@zhin.js/adapter-sandbox') {
          logger.log('');
          logger.log('🧭 适配器下一步：运行 zhin setup --adapters 添加 Endpoint，或启动后在 Console / IM 中执行 /endpoint add。');
        }
      } else if (pluginName) {
        logger.log('🔌 未自动启用插件。可手动添加到 zhin.config.yml:');
        logger.log('plugins:');
        logger.log(`  - "${pluginName}"`);
      }

      logger.log('');
      logger.log('下一步：');
      logger.log('  pnpm dev');
      logger.log('  zhin doctor');

    } catch (error) {
      logger.error('安装失败');
      throw error;
    }

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

function findProjectConfig(cwd: string): string | null {
  for (const candidate of CONFIG_CANDIDATES) {
    const filePath = path.join(cwd, candidate);
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

function readConfig(filePath: string): Record<string, unknown> {
  const content = fs.readFileSync(filePath, 'utf8');
  if (filePath.endsWith('.json')) {
    return JSON.parse(content) as Record<string, unknown>;
  }
  return (yaml.parse(content) ?? {}) as Record<string, unknown>;
}

function writeConfig(filePath: string, config: Record<string, unknown>): void {
  if (filePath.endsWith('.json')) {
    fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`);
    return;
  }
  fs.writeFileSync(filePath, yaml.stringify(config));
}

export function previewEnablePlugin(cwd: string, pluginName: string): EnablePluginResult {
  const configFile = findProjectConfig(cwd);
  if (!configFile) {
    return {
      status: 'missing-config',
      pluginName,
      message: `未找到 zhin.config.yml/json；将提示手动添加 ${pluginName}`,
    };
  }
  if (!configFile.endsWith('.yml') && !configFile.endsWith('.yaml') && !configFile.endsWith('.json')) {
    return {
      status: 'unsupported-config',
      configFile,
      pluginName,
      message: `${path.basename(configFile)} 暂不支持自动写入；将提示手动添加 ${pluginName}`,
    };
  }

  const config = readConfig(configFile);
  const plugins = Array.isArray(config.plugins) ? config.plugins : [];
  const alreadyEnabled = plugins.includes(pluginName);
  return {
    status: alreadyEnabled ? 'already-enabled' : 'enabled',
    configFile,
    pluginName,
    message: alreadyEnabled
      ? `${pluginName} 已在 ${path.basename(configFile)} 中启用`
      : `将在 ${path.basename(configFile)} 的 plugins 中添加 ${pluginName}`,
  };
}

export async function enablePluginInProjectConfig(cwd: string, pluginName: string): Promise<EnablePluginResult> {
  const preview = previewEnablePlugin(cwd, pluginName);
  if (preview.status !== 'enabled' || !preview.configFile) return preview;

  const config = readConfig(preview.configFile);
  const plugins = Array.isArray(config.plugins) ? [...config.plugins] : [];
  plugins.push(pluginName);
  config.plugins = plugins;
  writeConfig(preview.configFile, config);

  return {
    ...preview,
    message: `已在 ${path.basename(preview.configFile)} 中启用 ${pluginName}`,
  };
}
