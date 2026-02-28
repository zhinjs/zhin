/**
 * migrate — 将老版本 Zhin 项目快速升级到最新
 *
 * - 升级 package.json 中 zhin.js 与所有 @zhin.js/* 依赖为 latest
 * - 补全缺失的推荐 scripts、engines
 * - 确保 data、plugins 等目录存在
 * - 执行 pnpm install
 */

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';

const cwd = process.cwd();

const ZHIN_PACKAGE_PREFIX = '@zhin.js/';
const CORE_PACKAGE = 'zhin.js';

const RECOMMENDED_SCRIPTS: Record<string, string> = {
  dev: 'zhin dev',
  start: 'zhin start',
  daemon: 'zhin start --daemon',
  stop: 'zhin stop',
  build: 'tsc && zhin-console build',
};

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

function isWorkspaceProject(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'));
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

function upgradePackageJson(pkgPath: string, options: { toLatest: boolean; dryRun: boolean }): boolean {
  const pkg = fs.readJsonSync(pkgPath);
  const isWorkspace = isWorkspaceProject(path.dirname(pkgPath));

  const zhinDeps = collectZhinDeps(pkg);
  if (zhinDeps.length === 0) {
    logger.warn('未在 package.json 中发现 zhin.js 或 @zhin.js/* 依赖');
    return false;
  }

  let changed = false;
  const targetVersion = options.toLatest ? 'latest' : 'latest';

  for (const { dep, current, inDev } of zhinDeps) {
    const key = inDev ? 'devDependencies' : 'dependencies';
    const existing = pkg[key]?.[dep];
    if (existing === undefined) continue;
    // 保留 workspace 协议（monorepo 内不改为 latest）
    if (isWorkspace && (existing === 'workspace:*' || String(existing).startsWith('workspace:'))) {
      continue;
    }
    if (existing === targetVersion) continue;
    if (options.dryRun) {
      console.log(chalk.cyan(`  [dry-run] ${dep}: ${existing} → ${targetVersion}`));
    } else {
      pkg[key][dep] = targetVersion;
    }
    changed = true;
  }

  // 补全推荐 scripts（缺失则添加）
  if (!pkg.scripts) pkg.scripts = {};
  for (const [name, cmd] of Object.entries(RECOMMENDED_SCRIPTS)) {
    if (!pkg.scripts[name]) {
      if (options.dryRun) {
        console.log(chalk.cyan(`  [dry-run] scripts.${name} = "${cmd}"`));
      } else {
        pkg.scripts[name] = cmd;
      }
      changed = true;
    }
  }

  // 确保 engines.node
  if (!pkg.engines?.node) {
    if (options.dryRun) {
      console.log(chalk.cyan('  [dry-run] engines.node = ">=18.0.0"'));
    } else {
      pkg.engines = pkg.engines || {};
      pkg.engines.node = '>=18.0.0';
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
 * Checks for common Chinese header phrases from the original templates.
 */
function isOldChineseTemplate(content: string): boolean {
  const markers = [
    '我是一个能力出众',
    '行动导向的 AI 助手',
    '性格', '价值观', '工作方式',
    '工具使用原则', '调用风格',
    '你是得力的 AI 助手',
    '可用工具', '记忆',
    '工具组合', '常用工具场景',
  ];
  return markers.some(m => content.includes(m));
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

function upgradeBootstrapFiles(dir: string, dryRun: boolean): number {
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
          fs.writeFileSync(filePath, newContent, 'utf-8');
          console.log(chalk.green(`  ✓ ${name} upgraded to English template`));
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
        fs.writeFileSync(agentsPath, merged, 'utf-8');
        console.log(chalk.green(`  ✓ AGENTS.md upgraded to English (user data preserved)`));
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

function runInstall(dir: string, dryRun: boolean): boolean {
  const hasPnpm = fs.existsSync(path.join(dir, 'pnpm-lock.yaml'));
  const hasNpm = fs.existsSync(path.join(dir, 'package-lock.json'));
  const cmd = hasPnpm ? 'pnpm install' : hasNpm ? 'npm install' : 'pnpm install';
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
  .description('将老版本 Zhin 项目快速升级到最新（依赖、scripts、目录结构）')
  .option('--dry-run', '仅打印将要执行的操作，不写入文件也不安装依赖', false)
  .option('--no-install', '跳过最后一步 pnpm install', false)
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

    if (dryRun) {
      console.log(chalk.yellow('  [dry-run 模式] 以下变更不会实际写入'));
      console.log('');
    }

    // 1. 升级 package.json
    console.log(chalk.bold.blue('1. 升级依赖与 scripts'));
    const pkgChanged = upgradePackageJson(pkgPath, { toLatest: true, dryRun });
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
    if (runInstallAfter) {
      console.log(chalk.bold.blue('4. Install dependencies'));
      const ok = runInstall(cwd, dryRun);
      if (!ok && !dryRun) {
        process.exitCode = 1;
        return;
      }
      console.log('');
    }

    console.log(chalk.bold.green('✅ Migration complete'));
    console.log('');
    console.log(chalk.gray('Next steps:'));
    console.log(chalk.cyan('  zhin doctor') + chalk.gray('  check project health'));
    console.log(chalk.cyan('  pnpm dev') + chalk.gray('   start dev server'));
    console.log('');
  });
