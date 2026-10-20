/**
 * migrate — 将老版本 Zhin 项目快速升级到最新
 *
 * - 升级 package.json 中 zhin.js 与所有 @zhin.js/* 依赖为 latest（精确版本等用户锁定的依赖默认保留）
 * - 补全缺失的推荐 scripts、engines
 * - 确保 data、plugins 等目录存在
 * - 执行 pnpm install
 *
 * 配置格式（configVersion 2）迁移由独立的 `zhin migrate instances` 负责，本命令不改配置文件。
 */

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import path, { join } from 'path';
import { execSync } from 'child_process';
import { formatCompact } from '@zhin.js/logger';
import { logger } from '../utils/logger.js';
import { NODE_ENGINES_HINT } from '../utils/node-requirements.js';
import { applyInstanceDeclarationMigration, formatInstanceMigrationPreview, planInstanceDeclarationMigration, recoverInstanceDeclarationMigration } from '../plugin-runtime/migrate/instance-declarations.js';
import { CONFIG_V2_MIGRATION_DOCS_URL, detectLegacyConfig } from '../utils/legacy-config.js';

const cwd = process.cwd();

const ZHIN_PACKAGE_PREFIX = '@zhin.js/';
const CORE_PACKAGE = 'zhin.js';

const RECOMMENDED_SCRIPTS: Record<string, string> = {
  dev: 'zhin runtime start',
  start: 'zhin runtime start',
  daemon: 'zhin runtime start --daemon',
  stop: 'zhin stop',
  build: 'tsc --noEmit',
};

const LEGACY_SCRIPTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  dev: ['zhin dev'],
  start: ['zhin start'],
  daemon: ['zhin start --daemon'],
  build: ['zhin build'],
});

function isZhinProject(dir: string): boolean {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = fs.readJsonSync(pkgPath);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return CORE_PACKAGE in deps || 'zhin' in deps;
  } catch {
    return false;
  }
}

function collectZhinDeps(pkg: any): { dep: string; current: string; inDev: boolean }[] {
  const out: { dep: string; current: string; inDev: boolean }[] = [];
  const add = (name: string, version: string, inDev: boolean) => {
    if (name === CORE_PACKAGE || name.startsWith(ZHIN_PACKAGE_PREFIX)) {
      out.push({ dep: name, current: version, inDev });
    }
  };
  for (const [name, version] of Object.entries(pkg.dependencies || {})) {
    add(name, version as string, false);
  }
  for (const [name, version] of Object.entries(pkg.devDependencies || {})) {
    add(name, version as string, true);
  }
  return out;
}

/**
 * A specifier the user deliberately locked: exact versions, aliases, links, paths, git and tarballs.
 * Ranges (^, ~, >=, *, x) and dist-tags are considered "follow upstream" and may move to latest.
 */
export function isPinnedSpecifier(specifier: string): boolean {
  const value = specifier.trim();
  if (/^=?v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(value)) return true;
  return /^(?:link:|file:|portal:|npm:|catalog:|git\+|git:|github:|https?:|\.{0,2}\/)/.test(value);
}

export function upgradePackageJson(pkgPath: string, options: { toLatest: boolean; dryRun: boolean; includePinned?: boolean }): boolean {
  const pkg = fs.readJsonSync(pkgPath);

  const zhinDeps = collectZhinDeps(pkg);
  if (zhinDeps.length === 0) {
    logger.warn(formatCompact( { cmd: 'migrate', op: 'no_zhin_deps' }));
    return false;
  }

  let changed = false;
  const targetVersion = options.toLatest ? 'latest' : 'latest';

  for (const { dep, current, inDev } of zhinDeps) {
    const key = inDev ? 'devDependencies' : 'dependencies';
    const existing = pkg[key]?.[dep];
    if (existing === undefined) continue;
    // The explicit dependency source is authoritative, including in nested packages.
    if (String(existing).startsWith('workspace:')) {
      continue;
    }
    if (existing === targetVersion) continue;
    if (!options.includePinned && isPinnedSpecifier(String(existing))) {
      console.log(chalk.gray(`  · ${dep}: ${existing} 已锁定，保留（pinned, kept; use --include-pinned to move it to latest）`));
      continue;
    }
    if (options.dryRun) {
      console.log(chalk.cyan(`  [dry-run] ${dep}: ${existing} → ${targetVersion}`));
    } else {
      pkg[key][dep] = targetVersion;
    }
    changed = true;
  }

  // 替换已失效的启动入口，同时保留用户自定义 scripts。
  if (!pkg.scripts) pkg.scripts = {};
  for (const [name, cmd] of Object.entries(RECOMMENDED_SCRIPTS)) {
    const current = pkg.scripts[name];
    const isLegacy = typeof current === 'string'
      && (LEGACY_SCRIPTS[name] ?? []).includes(current.trim());
    if (!current || isLegacy) {
      if (options.dryRun) {
        console.log(chalk.cyan(`  [dry-run] scripts.${name}: ${current ?? '(missing)'} → "${cmd}"`));
      } else {
        pkg.scripts[name] = cmd;
      }
      changed = true;
    }
  }

  // 确保 engines.node
  if (!pkg.engines?.node) {
    if (options.dryRun) {
      console.log(chalk.cyan(`  [dry-run] engines.node = "${NODE_ENGINES_HINT}"`));
    } else {
      pkg.engines = pkg.engines || {};
      pkg.engines.node = NODE_ENGINES_HINT;
    }
    changed = true;
  }

  if (changed && !options.dryRun) {
    fs.writeJsonSync(pkgPath, pkg, { spaces: 2 });
  }
  return changed;
}

function ensureDirs(dir: string, dryRun: boolean): void {
  const dirs = ['data', 'plugins', 'src/plugins'];
  for (const d of dirs) {
    const full = path.join(dir, d);
    if (fs.existsSync(full)) continue;
    if (dryRun) {
      console.log(chalk.cyan(`  [dry-run] mkdir ${d}`));
    } else {
      fs.ensureDirSync(full);
      console.log(chalk.green(`  ✓ 确保目录 ${d}`));
    }
  }
}

// ============================================================================
// Bootstrap file upgrade (SOUL.md, TOOLS.md, AGENTS.md)
// ============================================================================

const NEW_SOUL_MD = `# Soul

Action-oriented AI assistant living in chat channels.

## Personality

- Prefer action over discussion. Execute first, explain after.
- Direct and concise. No filler or unnecessary disclaimers.
- Calm confidence. Honest about limitations without being dramatic.
- Adapt to the user's tone — casual when they're casual, precise when they need precision.
- Light humor when appropriate, but never at the expense of getting things done.
- Default optimistic. Problems are puzzles, errors are clues, setbacks are plot twists.

## Values

- Reliability over cleverness
- Transparency — report failures honestly, with a plan for next steps
- Respect context — remember what matters to the user
- Efficiency — no unnecessary back-and-forth

## Work Style

- Break complex tasks into tracked steps
- Verify by executing tools, never guess
- Report results, not intentions — "done" beats "I'll try"
- On failure: report, propose next step, no drama
`;

const NEW_TOOLS_MD = `# Tools Guide

- After skill activation, call its declared tools immediately — no explaining or waiting
- Answers must be based on actual tool results, never guess
- On tool failure, try alternatives instead of reporting raw errors
- Use \`spawn_task\` for complex/long-running background tasks
- Persist important info to \`memory/MEMORY.md\`, periodic tasks to \`HEARTBEAT.md\`
`;

const NEW_AGENTS_MD_HEADER = `# Agent Instructions

Helpful AI assistant. Be concise, accurate, and action-oriented.

## Guidelines

- Briefly state what you're doing before acting
- Clarify ambiguous requests before executing
- Use tools to accomplish tasks; persist important info to memory

## Reminders

Use \`cron_add\` for scheduled reminders — do NOT just write to memory files.

## Heartbeat

If enabled, \`HEARTBEAT.md\` is checked periodically. Manage task lists via \`edit_file\` / \`write_file\`. Keep the file small to save tokens.

---

# Agent Memory

Long-term memory for conversation history, user preferences, and system state.`;

/**
 * Detect whether a file is using the old Chinese template.
 * 需同时命中多个特异短语，避免单个高频词（如「记忆」「工具组合」）误伤用户自定义文件。
 */
export function isOldChineseTemplate(content: string): boolean {
  const markers = [
    '我是一个能力出众',
    '行动导向的 AI 助手',
    '工具使用原则',
    '调用风格',
    '你是得力的 AI 助手',
    '常用工具场景',
    '记忆与学习',
    '激活专业技能',
  ];
  const hits = markers.filter(m => content.includes(m)).length;
  return hits >= 2;
}

/**
 * Extract user-written sections from an existing AGENTS.md.
 * Preserves: User Preferences, Important Records, TODO sections.
 */
function extractUserSections(content: string): { preferences: string; records: string; todo: string } {
  const lines = content.split('\n');
  let preferences = '';
  let records = '';
  let todo = '';

  let currentSection: 'none' | 'preferences' | 'records' | 'todo' = 'none';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    if (lower.includes('用户偏好') || lower.includes('user preference')) {
      currentSection = 'preferences';
      continue;
    } else if (lower.includes('重要记录') || lower.includes('important record')) {
      currentSection = 'records';
      continue;
    } else if (lower.includes('待办事项') || lower.includes('## todo')) {
      currentSection = 'todo';
      continue;
    } else if (/^##\s/.test(line) && currentSection !== 'none') {
      currentSection = 'none';
    }

    switch (currentSection) {
      case 'preferences': preferences += line + '\n'; break;
      case 'records': records += line + '\n'; break;
      case 'todo': todo += line + '\n'; break;
    }
  }

  return {
    preferences: preferences.trim(),
    records: records.trim(),
    todo: todo.trim(),
  };
}

function buildNewAgentsMd(existingContent?: string): string {
  const defaultPrefs = `- Language: Simplified Chinese (简体中文)\n- Style: concise, action-first, execute over explain`;
  const defaultRecords = `*(AI can append here via write_file / write_memory)*`;
  const defaultTodo = `*(Track pending work here)*`;

  let prefs = defaultPrefs;
  let records = defaultRecords;
  let todo = defaultTodo;

  if (existingContent) {
    const extracted = extractUserSections(existingContent);
    if (extracted.preferences) prefs = extracted.preferences;
    if (extracted.records) records = extracted.records;
    if (extracted.todo) todo = extracted.todo;
  }

  return `${NEW_AGENTS_MD_HEADER}

## User Preferences

${prefs}

## Important Records

${records}

## TODO

${todo}
`;
}

/** 覆盖已有文件前备份为 <file>.bak */
function backupBeforeOverwrite(filePath: string): void {
  fs.copyFileSync(filePath, `${filePath}.bak`);
}

export function upgradeBootstrapFiles(dir: string, dryRun: boolean): number {
  let upgraded = 0;
  const files = [
    { name: 'SOUL.md', newContent: NEW_SOUL_MD },
    { name: 'TOOLS.md', newContent: NEW_TOOLS_MD },
  ];

  for (const { name, newContent } of files) {
    const filePath = path.join(dir, name);
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, 'utf-8');
      if (isOldChineseTemplate(existing)) {
        if (dryRun) {
          console.log(chalk.cyan(`  [dry-run] ${name}: upgrade to English template`));
        } else {
          backupBeforeOverwrite(filePath);
          fs.writeFileSync(filePath, newContent, 'utf-8');
          console.log(chalk.green(`  ✓ ${name} upgraded to English template (backup: ${name}.bak)`));
        }
        upgraded++;
      } else {
        console.log(chalk.gray(`  · ${name} already customized, skipped`));
      }
    } else {
      if (dryRun) {
        console.log(chalk.cyan(`  [dry-run] ${name}: create new`));
      } else {
        fs.writeFileSync(filePath, newContent, 'utf-8');
        console.log(chalk.green(`  ✓ ${name} created`));
      }
      upgraded++;
    }
  }

  // AGENTS.md — special handling to preserve user data
  const agentsPath = path.join(dir, 'AGENTS.md');
  if (fs.existsSync(agentsPath)) {
    const existing = fs.readFileSync(agentsPath, 'utf-8');
    if (isOldChineseTemplate(existing)) {
      const merged = buildNewAgentsMd(existing);
      if (dryRun) {
        console.log(chalk.cyan(`  [dry-run] AGENTS.md: upgrade to English (user data preserved)`));
      } else {
        backupBeforeOverwrite(agentsPath);
        fs.writeFileSync(agentsPath, merged, 'utf-8');
        console.log(chalk.green(`  ✓ AGENTS.md upgraded to English (user data preserved, backup: AGENTS.md.bak)`));
      }
      upgraded++;
    } else {
      console.log(chalk.gray(`  · AGENTS.md already customized, skipped`));
    }
  } else {
    const fresh = buildNewAgentsMd();
    if (dryRun) {
      console.log(chalk.cyan(`  [dry-run] AGENTS.md: create new`));
    } else {
      fs.writeFileSync(agentsPath, fresh, 'utf-8');
      console.log(chalk.green(`  ✓ AGENTS.md created`));
    }
    upgraded++;
  }

  return upgraded;
}

function resolveMigrationInstallCommand(dir: string): string | undefined {
  const hasPnpm = fs.existsSync(path.join(dir, 'pnpm-lock.yaml'));
  const hasNpm = fs.existsSync(path.join(dir, 'package-lock.json'));
  if (hasNpm && !hasPnpm) {
    const pkg = fs.readJsonSync(path.join(dir, 'package.json'));
    const workspaceDependency = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
      .some(field => Object.values(pkg[field] ?? {})
        .some(value => typeof value === 'string' && value.startsWith('workspace:')));
    if (workspaceDependency) {
      logger.error('npm 不支持 workspace: 依赖，尚未改动项目。请先确认 pnpm 工作区配置并执行 pnpm install；或使用 --no-install 仅迁移清单。');
      return undefined;
    }
  }
  // Migration edits dependency specifiers, so its install must refresh the lockfile even in CI.
  return hasNpm && !hasPnpm ? 'npm install' : 'pnpm install --no-frozen-lockfile';
}

function runInstall(dir: string, dryRun: boolean, cmd: string): boolean {
  if (dryRun) {
    console.log(chalk.cyan(`  [dry-run] ${cmd}`));
    return true;
  }
  try {
    execSync(cmd, { cwd: dir, stdio: 'inherit' });
    return true;
  } catch {
    logger.error(`执行 ${cmd} 失败，请手动在项目目录执行`);
    return false;
  }
}

export const migrateCommand = new Command('migrate')
  .description('升级项目依赖、scripts 与目录结构；v1 配置（缺少 configVersion: 2）请用 zhin migrate instances')
  .option('--dry-run', '仅打印将要执行的操作，不写入文件也不安装依赖', false)
  .option('--no-install', '跳过最后一步依赖安装')
  .option('--include-pinned', '把精确版本等已锁定的 zhin 依赖也改为 latest（默认保留）', false)
  .addHelpText('after', `
配置格式迁移 / Config format migration (configVersion 2):
  启动报 "configVersion must be 2" 或检测到 v1 配置时，先停止 Bot，再运行：
    zhin migrate instances            预览改动，不写文件 / preview only
    zhin migrate instances --apply    应用并自动备份 / apply with automatic backup
  文档 / Docs: ${CONFIG_V2_MIGRATION_DOCS_URL}

注意：zhin runtime migrate [phase] 是旧插件能力代码迁移（extract/cutover），与配置版本无关。
Note: "zhin runtime migrate" migrates legacy plugin capability code, not the config version.`)
  .action(async (options) => {
    console.log('');
    console.log(chalk.bold.cyan('  Zhin 项目升级 (migrate)'));
    console.log('');

    if (!isZhinProject(cwd)) {
      logger.error('当前目录不是 Zhin 项目（package.json 中未找到 zhin.js 依赖）');
      process.exit(1);
    }

    const pkgPath = path.join(cwd, 'package.json');
    const dryRun = !!options.dryRun;
    const runInstallAfter = options.install !== false;
    const installCommand = runInstallAfter ? resolveMigrationInstallCommand(cwd) : undefined;
    if (runInstallAfter && !installCommand) {
      process.exitCode = 1;
      return;
    }

    if (dryRun) {
      console.log(chalk.yellow('  [dry-run 模式] 以下变更不会实际写入'));
      console.log('');
    }

    // 1. 升级 package.json
    console.log(chalk.bold.blue('1. 升级依赖与 scripts'));
    const pkgChanged = upgradePackageJson(pkgPath, { toLatest: true, dryRun, includePinned: !!options.includePinned });
    if (pkgChanged && !dryRun) {
      console.log(chalk.green('  ✓ package.json 已更新'));
    } else if (dryRun && collectZhinDeps(fs.readJsonSync(pkgPath)).length > 0) {
      console.log(chalk.gray('  (见上方 [dry-run] 变更)'));
    }
    console.log('');

    // 2. 确保目录
    console.log(chalk.bold.blue('2. Ensure directory structure'));
    ensureDirs(cwd, dryRun);
    console.log('');

    // 3. Upgrade bootstrap files (SOUL.md, TOOLS.md, AGENTS.md)
    console.log(chalk.bold.blue('3. Upgrade bootstrap files'));
    const bootstrapCount = upgradeBootstrapFiles(cwd, dryRun);
    if (bootstrapCount === 0) {
      console.log(chalk.gray('  No bootstrap files need upgrading'));
    }
    console.log('');

    // 4. 安装依赖
    if (installCommand) {
      console.log(chalk.bold.blue('4. Install dependencies'));
      const ok = runInstall(cwd, dryRun, installCommand);
      if (!ok && !dryRun) {
        process.exitCode = 1;
        return;
      }
      console.log('');
    }

    if (dryRun) console.log(chalk.bold.yellow('Dry run finished: nothing was changed. 未写入任何文件，也未安装依赖。'));
    else console.log(chalk.bold.green('✅ Migration complete'));
    console.log('');
    const legacy = await detectLegacyConfig(cwd);
    if (legacy.legacy) {
      // This command never rewrites config files; point to the dedicated converter.
      console.log(chalk.yellow('配置仍是 v1 格式，新版 Runtime 会拒绝启动。先停止 Bot，再运行：'));
      console.log(chalk.yellow('Your config is still v1 and the new runtime will refuse it. Stop the Bot, then run:'));
      console.log(chalk.cyan('  zhin migrate instances') + chalk.gray('          preview'));
      console.log(chalk.cyan('  zhin migrate instances --apply') + chalk.gray('  apply (automatic backup)'));
      console.log(chalk.gray(`  ${CONFIG_V2_MIGRATION_DOCS_URL}`));
      console.log('');
    }
    console.log(chalk.gray('Next steps:'));
    console.log(chalk.cyan('  zhin doctor') + chalk.gray('  check project health'));
    console.log(chalk.cyan('  pnpm dev') + chalk.gray('   start dev server'));
    console.log('');
  });

// Explicit declaration conversion never invokes the general dependency upgrader.
migrateCommand.addCommand(new Command('instances')
  .description('离线转换旧实例声明为 configVersion: 2（默认仅预览）')
  .option('--apply', '确认 Bot 已停止后写入，保留原文备份与恢复日志')
  .option('--dry-run', '只检查并列出转换计划（默认）')
  .option('--recover <action>', '恢复未完成转换：continue 或 rollback')
  .option('--lifecycle-file <path>', '显式指定旧停用状态文件（绝对路径）')
  .option('--json', '以 JSON 输出迁移计划（仅含摘要，不含配置值）')
  .action(async (options: { apply?: boolean; dryRun?: boolean; recover?: string; lifecycleFile?: string; json?: boolean }) => {
    const root = process.cwd();
    const dryRun = options.dryRun || migrateCommand.opts().dryRun;
    if (options.apply && dryRun) throw new Error('--apply and --dry-run cannot be combined');
    if (options.recover) {
      if (options.apply || dryRun || options.lifecycleFile) throw new Error('--recover cannot be combined with plan/apply flags');
      if (options.recover !== 'continue' && options.recover !== 'rollback') throw new Error('--recover must be continue or rollback');
      await recoverInstanceDeclarationMigration(root, options.recover);
      console.log(`Instance declaration recovery ${options.recover} completed. Backups remain in .zhin/instance-declarations-migration.`);
      return;
    }
    const plan = await planInstanceDeclarationMigration(root, { lifecycleFile: options.lifecycleFile });
    if (options.json) {
      console.log(JSON.stringify({
        mode: options.apply ? 'apply' : 'dry-run',
        instances: plan.instances,
        files: plan.files.map(file => ({ path: file.path, before: file.before.digest, after: file.after.digest })),
        pendingChecks: plan.pendingChecks,
      }, null, 2));
    } else {
      console.log(formatInstanceMigrationPreview(plan, { mode: options.apply ? 'apply' : 'dry-run' }));
    }
    if (options.apply) {
      const result = await applyInstanceDeclarationMigration(plan);
      console.log(`Migration applied. Backup / 备份: ${result.backupDirectory}`);
      console.log('Restore / 恢复: zhin migrate instances --recover rollback');
      console.log(`  (or copy the files listed in ${join(result.backupDirectory, 'manifest.json')} back to their original paths)`);
      console.log('Next / 下一步: zhin config check, then start the Bot again.');
    } else {
      console.log('dry-run: no files changed. 未写入任何文件。Stop the Bot, review the plan, then run: zhin migrate instances --apply');
    }
  }));
