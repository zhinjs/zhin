import { Command } from 'commander';
import { formatCompact } from '@zhin.js/logger';
import { logger } from '../utils/logger.js';
import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import { execSync } from 'node:child_process';

interface PublishOptions {
  tag?: string;
  access?: 'public' | 'restricted';
  registry?: string;
  dryRun?: boolean;
  skipBuild?: boolean;
  yes?: boolean;
}

/** 递归扫描 plugins/ 下含 package.json 的 Zhin 包（扁平 my-plugin 或嵌套 adapters/icqq） */
interface PluginPublishCandidate {
  relPath: string;
  absPath: string;
}

function isLikelyZhinPluginPackage(pkg: {
  name?: string;
  keywords?: string[];
  zhin?: unknown;
}): boolean {
  if (hasZhinManifest(pkg)) return true;
  const n = pkg.name ?? '';
  if (/^zhin\.js-/.test(n)) return true;
  if (/^@zhin\.js\//.test(n)) return true;
  if (pkg.keywords?.includes('zhin.js')) return true;
  return false;
}

function hasZhinManifest(pkg: { zhin?: unknown }): boolean {
  return typeof pkg.zhin === 'object' && pkg.zhin !== null && !Array.isArray(pkg.zhin);
}

function readManifest(dir: string): Record<string, unknown> | undefined {
  try {
    return fs.readJsonSync(path.join(dir, 'package.json')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

const BOT_CONFIG_FILES = ['zhin.config.yml', 'zhin.config.yaml', 'zhin.config.json'];

export type PublishTarget =
  | { readonly kind: 'directory'; readonly dir: string }
  | { readonly kind: 'workspace'; readonly pluginsDir: string }
  | { readonly kind: 'none'; readonly message: string };

/**
 * 决定 `zhin pub [arg]` 发布哪个包：
 * 1. `arg` 是含 zhin 清单的目录（如 `.`、`../my-plugin`）→ 直接发布该目录；
 * 2. 当前目录是 Bot 项目（有 `plugins/`）→ 在 `plugins/` 下按名字查找（原有行为）；
 * 3. 不带参数、当前目录本身是插件包（`zhin new --standalone` 生成的仓库）→ 发布当前目录。
 */
export function resolvePublishTarget(cwd: string, arg: string | undefined): PublishTarget {
  if (arg) {
    const dir = path.resolve(cwd, arg);
    const manifest = fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? readManifest(dir) : undefined;
    const dirIsBot = BOT_CONFIG_FILES.some((file) => fs.existsSync(path.join(dir, file)));
    if (manifest && hasZhinManifest(manifest) && !dirIsBot) return { kind: 'directory', dir };
  }
  const pluginsDir = path.resolve(cwd, 'plugins');
  const isBot = BOT_CONFIG_FILES.some((file) => fs.existsSync(path.join(cwd, file)));
  if (fs.existsSync(pluginsDir) && (isBot || arg)) return { kind: 'workspace', pluginsDir };
  const own = readManifest(cwd);
  if (!arg && own && hasZhinManifest(own) && !isBot) return { kind: 'directory', dir: cwd };
  if (fs.existsSync(pluginsDir)) return { kind: 'workspace', pluginsDir };
  return {
    kind: 'none',
    message: arg
      ? `未找到插件：${arg}（既不是含 zhin 字段的 package.json 目录，当前目录也没有 plugins/）`
      : '当前目录既不是插件包（package.json 缺少 zhin 字段），也不是含 plugins/ 的 Bot 项目',
  };
}

function collectPluginPublishCandidates(pluginsDir: string): PluginPublishCandidate[] {
  const out: PluginPublishCandidate[] = [];

  const walk = (abs: string, rel: string): void => {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return;
    const pkgJson = path.join(abs, 'package.json');
    if (fs.existsSync(pkgJson)) {
      try {
        const pkg = fs.readJsonSync(pkgJson) as {
          name?: string;
          keywords?: string[];
        };
        if (isLikelyZhinPluginPackage(pkg)) {
          out.push({
            relPath: rel || path.basename(abs),
            absPath: abs,
          });
          return;
        }
      } catch {
        /* 忽略损坏的 package.json */
      }
    }
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name === 'node_modules' || ent.name.startsWith('.')) {
        continue;
      }
      walk(path.join(abs, ent.name), rel ? `${rel}/${ent.name}` : ent.name);
    }
  };

  walk(pluginsDir, '');
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

function resolvePublishCandidate(
  candidates: PluginPublishCandidate[],
  pluginArg: string | undefined,
): PluginPublishCandidate | undefined {
  if (!pluginArg) return undefined;
  const exact = candidates.find((c) => c.relPath === pluginArg);
  if (exact) return exact;
  const base = path.basename(pluginArg);
  const byBase = candidates.filter((c) => path.basename(c.relPath) === base);
  if (byBase.length === 1) return byBase[0];
  return undefined;
}

export const pubCommand = new Command('pub')
  .description('发布插件到 npm（在 zhin new --standalone 生成的插件目录内可直接运行：npx @zhin.js/cli pub）')
  .argument(
    '[plugin-name]',
    '在插件包目录内可省略（发布当前目录）；也可以是插件目录路径（如 . 或 ../my-plugin）；在 Bot 项目根是相对 plugins/ 的路径（如 my-plugin 或 adapters/icqq）',
  )
  .option('--tag <tag>', '发布标签', 'latest')
  .option('--access <access>', '访问级别 (public|restricted)', 'public')
  .option('--registry <url>', '自定义 npm registry')
  .option('--dry-run', '试运行，不实际发布', false)
  .option('--skip-build', '跳过构建步骤', false)
  .option('-y, --yes', '跳过发布确认（非交互环境需要）', false)
  .action(async (pluginName: string, options: PublishOptions) => {
    try {
      const target = resolvePublishTarget(process.cwd(), pluginName);
      if (target.kind === 'none') {
        logger.error(target.message);
        process.exit(1);
      }
      let pluginDir: string;
      if (target.kind === 'directory') {
        pluginDir = target.dir;
      } else {
        const { pluginsDir } = target;
        const candidates = collectPluginPublishCandidates(pluginsDir);

        if (candidates.length === 0) {
          logger.error('未找到可发布的插件（需在 plugins 下存在含 zhin 字段、zhin.js / @zhin.js/* 包名或 keywords 含 zhin.js 的 package.json）');
          process.exit(1);
        }

        // 如果没有指定插件名，让用户选择
        let selected: PluginPublishCandidate | undefined;
        if (!pluginName) {
          if (candidates.length === 1) {
            selected = candidates[0];
            logger.info(formatCompact( { cmd: 'pub', op: 'select', plugin: selected!.relPath }));
          } else {
            if (!process.stdin.isTTY) {
              logger.error(`非交互环境请指定插件：zhin pub <名字>\n可用插件（相对 plugins/）:\n  ${candidates.map((c) => c.relPath).join('\n  ')}`);
              process.exit(1);
            }
            const { plugin } = await inquirer.prompt([
              {
                type: 'select',
                name: 'plugin',
                message: '请选择要发布的插件:',
                choices: candidates.map((c) => ({
                  name: `${c.relPath} (${path.basename(c.absPath)})`,
                  value: c.relPath,
                })),
              },
            ]);
            selected = candidates.find((c) => c.relPath === plugin) ?? resolvePublishCandidate(candidates, plugin);
          }
        } else {
          selected = resolvePublishCandidate(candidates, pluginName);
          if (!selected) {
            logger.error(`未找到插件: ${pluginName}`);
            logger.log(`可用插件（相对 plugins/）:\n  ${candidates.map((c) => c.relPath).join('\n  ')}`);
            process.exit(1);
          }
        }

        if (!selected) {
          logger.error('未选择插件');
          process.exit(1);
        }

        pluginDir = selected.absPath;
      }

      const packageJsonPath = path.join(pluginDir, 'package.json');
      if (!fs.existsSync(packageJsonPath)) {
        logger.error(`未找到 package.json: ${packageJsonPath}`);
        process.exit(1);
      }

      // 读取 package.json
      const packageJson = await fs.readJson(packageJsonPath);
      const packageName = packageJson.name;
      const version = packageJson.version;

      logger.info(formatCompact( { cmd: 'pub', op: 'prepare', package: packageName, version }));
      logger.log('');

      if (packageJson.private === true) {
        logger.error(`${packageName} 的 package.json 设置了 private: true，npm 会拒绝发布`);
        process.exit(1);
      }
      const entry = packageJson.zhin?.entry;
      if (typeof entry === 'string' && /\.tsx?$/u.test(entry)) {
        logger.warn(`zhin.entry 是 ${entry}：从 npm 安装的插件会优先加载 JavaScript，发布包请把入口写成 .js 并在 prepack 构建`);
      }

      // 确认发布
      if (!options.dryRun && !options.yes) {
        if (!process.stdin.isTTY) {
          logger.error('非交互环境无法确认发布：加 --yes 跳过确认，或先用 --dry-run 预览');
          process.exit(1);
        }
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `确认发布 ${packageName}@${version} 到 npm？`,
            default: false
          }
        ]);

        if (!confirm) {
          logger.warn(formatCompact( { cmd: 'pub', op: 'cancelled' }));
          process.exit(0);
        }
      }

      // 构建插件
      if (!options.skipBuild) {
        logger.info(formatCompact( { cmd: 'pub', op: 'build' }));
        try {
          execSync('pnpm build', {
            cwd: pluginDir,
            stdio: 'inherit'
          });
          logger.success('✓ 构建完成');
        } catch (error) {
          logger.error('构建失败');
          throw error;
        }
      }

      // 构建 npm publish 命令
      const publishArgs = ['publish'];
      
      if (options.access) {
        publishArgs.push('--access', options.access);
      }
      
      if (options.tag) {
        publishArgs.push('--tag', options.tag);
      }
      
      if (options.registry) {
        publishArgs.push('--registry', options.registry);
      }
      
      if (options.dryRun) {
        publishArgs.push('--dry-run');
      }

      // 总是添加 --no-git-checks（因为 plugins 可能不是 git 根目录）
      publishArgs.push('--no-git-checks');

      // 发布插件
      logger.info(formatCompact( { cmd: 'pub', op: 'publish', dry_run: options.dryRun ?? false }));
      logger.log(`命令: pnpm ${publishArgs.join(' ')}`);
      logger.log('');

      try {
        execSync(`pnpm ${publishArgs.join(' ')}`, {
          cwd: pluginDir,
          stdio: 'inherit'
        });

        if (options.dryRun) {
          logger.success('✓ 试运行完成');
          logger.log('');
          logger.log('💡 提示: 移除 --dry-run 参数以实际发布');
        } else {
          logger.success(`✓ ${packageName}@${version} 发布成功！`);
          logger.log('');
          logger.log('📦 安装命令:');
          logger.log(`  pnpm add ${packageName}`);
          logger.log('');
          logger.log('🔗 npm 链接:');
          logger.log(`  https://www.npmjs.com/package/${packageName}`);
        }
      } catch (error) {
        logger.error('发布失败');
        throw error;
      }

    } catch (error: unknown) {
      logger.error(`发布失败: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

