/**
 * migrate — 将老版本 Zhin 项目快速升级到最新
 *
 * - 升级 package.json 中 zhin.js 与所有 @zhin.js/* 依赖到 registry 上的最新版本（写 ^x.y.z；精确版本保持精确，
 *   用户锁定的依赖默认保留），并按目标 zhin.js 的依赖对齐 pnpm.overrides 中的 @zhin.js/*
 * - 在 pnpm-workspace.yaml 的 allowBuilds 中补齐网关原生依赖（node-pty、ssh2、cpu-features），已有条目保留
 * - 补全缺失的推荐 scripts、engines
 * - 确保 data、plugins 等目录存在
 * - 执行 pnpm install
 *
 * 配置格式（configVersion 2）迁移由独立的 `zhin migrate instances` 负责，本命令不改配置文件。
 */

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import path, { join, resolve } from 'path';
import { execSync } from 'child_process';
import { formatCompact } from '@zhin.js/logger';
import { logger } from '../utils/logger.js';
import { NODE_ENGINES_HINT } from '@zhin.js/gateway/project';
import { applyInstanceDeclarationMigration, formatInstanceMigrationPreview, planInstanceDeclarationMigration, recoverInstanceDeclarationMigration } from '@zhin.js/gateway/project';
import { CONFIG_V2_MIGRATION_DOCS_URL, detectLegacyConfig } from '@zhin.js/gateway/project';
import { importProjectInstanceCli } from '../utils/project-instance.js';
import { isLegacyScript, LEGACY_START_SCRIPTS, RECOMMENDED_START_SCRIPTS } from '../plugin-runtime/migrate/start-scripts.js';
import { gatewayRangeFor, isBotProjectDirectory, withStartStackDependencies } from '../plugin-runtime/migrate/start-stack-dependencies.js';
import { withScaffoldVersionRanges } from '@zhin.js/scaffold-wizard';
import { cachedRegistryLookup, npmRegistryLookup, type RegistryLookup } from '../utils/registry-version.js';
import { syncNativeBuildAllowance, usesPnpm } from '../utils/native-build-deps.js';
import {
  compareInstalledVersions,
  declaredZhinDependencies,
  detectPnpmMajor,
  explainVersionMismatch,
  formatInstalledVersionRows,
  snapshotInstalledVersions,
  syncReleaseAgeExclusions,
} from '../utils/installed-versions.js';
import { readConfig, findConfigFile } from '@zhin.js/gateway/project';
import { isAiEnabledInConfig } from '@zhin.js/scaffold-wizard';

const cwd = process.cwd();

const ZHIN_PACKAGE_PREFIX = '@zhin.js/';
const CORE_PACKAGE = 'zhin.js';

// `zhin start` is the entry (ADR 0054 §6); `zhin runtime start` is an accepted alias, never rewritten.
// A bare `zhin start` in `start` / `dev` is rewritten: it runs in the background by default now.
const RECOMMENDED_SCRIPTS: Record<string, string> = {
  ...RECOMMENDED_START_SCRIPTS,
  stop: 'zhin stop',
  build: 'tsc --noEmit',
};

const LEGACY_SCRIPTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ...LEGACY_START_SCRIPTS,
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
  if (isExactVersionSpecifier(value)) return true;
  return /^(?:link:|file:|portal:|npm:|catalog:|git\+|git:|github:|https?:|\.{0,2}\/)/.test(value);
}

/** An exact version (`1.2.3`, `=1.2.3`, `v1.2.3-beta.1`): an upgrade keeps it exact. */
export function isExactVersionSpecifier(specifier: string): boolean {
  return /^=?v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(specifier.trim());
}

/** Local or referenced override values (`workspace:`, `link:`, `file:`, `$dep`) are the user's own wiring. */
function isLocalOverride(value: string): boolean {
  return /^(?:workspace:|link:|file:|portal:|\$|\.{0,2}\/)/.test(value.trim());
}

export interface UpgradePackageJsonOptions {
  toLatest: boolean;
  dryRun: boolean;
  includePinned?: boolean;
  /** Registry lookup; defaults to `npm view` against the project's configured registry. */
  lookup?: RegistryLookup;
}

export function upgradePackageJson(pkgPath: string, options: UpgradePackageJsonOptions): boolean {
  const pkg = fs.readJsonSync(pkgPath);

  const zhinDeps = collectZhinDeps(pkg);
  if (zhinDeps.length === 0) {
    logger.warn(formatCompact( { cmd: 'migrate', op: 'no_zhin_deps' }));
    return false;
  }

  let changed = false;
  const lookup = cachedRegistryLookup(options.lookup ?? npmRegistryLookup);
  /** The specifier an upgrade writes: the registry's latest release, exact when the old one was exact. */
  /** Registry releases the upgrade targets (`name → version`), for pnpm's release-age exclusions. */
  const releases = new Map<string, string>();
  const upgradeSpecifier = (dep: string, existing: string): string | undefined => {
    const release = lookup(dep);
    if (!release) return undefined;
    releases.set(dep, release.version);
    return isExactVersionSpecifier(existing) ? release.version : `^${release.version}`;
  };

  // `zhin start` needs zhin.js, the CLI and the gateway in production: a bot project lists all
  // three under dependencies (older projects had the CLI in devDependencies and no gateway).
  // Moves happen before the upgrade below; an added package is versioned after it, so the
  // gateway follows the CLI's final specifier.
  const added = new Set<string>();
  const upgraded = new Map<string, string>();
  if (isBotProjectDirectory(path.dirname(pkgPath))) {
    const stack = withStartStackDependencies(pkg.dependencies, pkg.devDependencies);
    for (const change of stack.changes) {
      if (change.kind === 'add') {
        added.add(change.name);
        continue;
      }
      const message = change.kind === 'move'
        ? `${change.name}: devDependencies → dependencies (${change.version})`
        : change.kind === 'drop-dev-placeholder'
          ? `${change.name}: devDependencies 中的占位版本 ${change.version} 已移除，改在 dependencies 中声明`
          : `${change.name}: devDependencies 中的重复项已移除（dependencies 中已声明）`;
      console.log(chalk.cyan(options.dryRun ? `  [dry-run] ${message}` : `  · ${message}`));
    }
    if (stack.changes.length > 0) {
      changed = true;
      pkg.dependencies = stack.dependencies;
      if (Object.keys(stack.devDependencies).length > 0) pkg.devDependencies = stack.devDependencies;
      else delete pkg.devDependencies;
    }
  }

  for (const { dep, inDev } of collectZhinDeps(pkg)) {
    if (added.has(dep)) continue;
    const key = inDev ? 'devDependencies' : 'dependencies';
    const existing = pkg[key]?.[dep];
    if (existing === undefined) continue;
    // The explicit dependency source is authoritative, including in nested packages.
    if (String(existing).startsWith('workspace:')) {
      continue;
    }
    if (!options.includePinned && isPinnedSpecifier(String(existing))) {
      console.log(chalk.gray(`  · ${dep}: ${existing} 已锁定，保留（加 --include-pinned 一并升级）`));
      continue;
    }
    const next = upgradeSpecifier(dep, String(existing));
    if (next === undefined) {
      console.log(chalk.yellow(`  ! ${dep}: 无法从 registry 查询最新版本，保留 ${existing}`));
      continue;
    }
    if (existing === next) continue;
    if (options.dryRun) {
      console.log(chalk.cyan(`  [dry-run] ${dep}: ${existing} → ${next}`));
    } else {
      pkg[key][dep] = next;
    }
    upgraded.set(dep, next);
    changed = true;
  }

  for (const name of added) {
    let version: string;
    if (name === '@zhin.js/gateway') {
      version = gatewayRangeFor(upgraded.get('@zhin.js/cli') ?? String(pkg.dependencies['@zhin.js/cli']));
      const floor = /^[\^~]?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u.exec(version)?.[1];
      if (floor) releases.set(name, floor);
    } else {
      // An added package gets the registry's release; offline, the range released with this CLI.
      const release = lookup(name);
      if (release) releases.set(name, release.version);
      version = release
        ? `^${release.version}`
        : withScaffoldVersionRanges({ [name]: String(pkg.dependencies[name]) })[name] ?? String(pkg.dependencies[name]);
      upgraded.set(name, version);
    }
    pkg.dependencies[name] = version;
    console.log(chalk.cyan(`  ${options.dryRun ? '[dry-run]' : '·'} ${name}: + dependencies (${version})`));
  }

  if (syncZhinOverrides(pkg, upgraded, lookup, options.dryRun)) changed = true;

  // pnpm 10+ skips dependency build scripts: allow the gateway's native ones (node-pty for the
  // Console terminal) in pnpm-workspace.yaml; the install below then builds them.
  if (syncNativeBuildAllowance(path.dirname(pkgPath), pkg, options.dryRun)) changed = true;

  // pnpm 11 holds back releases younger than minimumReleaseAge (one day by default) and would keep
  // the old version ("Already up to date"): list the targets in minimumReleaseAgeExclude, as pnpm
  // itself does in a fresh scaffold. Only for pnpm projects, and only the registry releases the
  // (possibly unchanged) specifiers now point at — pinned and local specifiers are never listed.
  if (usesPnpm(path.dirname(pkgPath), pkg)) {
    syncReleaseAgeExclusions(path.dirname(pkgPath), releases, options.dryRun);
  }

  // 替换已失效的启动入口，同时保留用户自定义 scripts。
  if (!pkg.scripts) pkg.scripts = {};
  for (const [name, cmd] of Object.entries(RECOMMENDED_SCRIPTS)) {
    const current = pkg.scripts[name];
    const isLegacy = isLegacyScript(LEGACY_SCRIPTS, name, current);
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

/**
 * Aligns `pnpm.overrides` entries for `@zhin.js/*` with the target `zhin.js` release: an override
 * left on an old version would otherwise pin a second copy next to the upgraded one (doctor then
 * reports duplicate Zhin packages). The target is the upgraded `zhin.js` specifier, or the declared
 * one when it is an exact version; its registry `dependencies` give the range for each package.
 * An override for a package `zhin.js` does not depend on follows that package's upgraded
 * specifier. Local wiring (`workspace:`, `link:`, `file:`, `$ref`) and selector keys
 * (`a>b`, `name@range`) are left alone.
 */
function syncZhinOverrides(pkg: any, upgraded: ReadonlyMap<string, string>, lookup: RegistryLookup, dryRun: boolean): boolean {
  const overrides = pkg.pnpm?.overrides;
  if (!overrides || typeof overrides !== 'object') return false;
  const names = Object.keys(overrides).filter(key => key.startsWith(ZHIN_PACKAGE_PREFIX) && !key.includes('>') && !key.slice(1).includes('@'));
  if (names.length === 0) return false;

  const declared = String(pkg.dependencies?.[CORE_PACKAGE] ?? pkg.devDependencies?.[CORE_PACKAGE] ?? '');
  const target = upgraded.get(CORE_PACKAGE) ?? (isExactVersionSpecifier(declared) ? declared.replace(/^=?v?/, '') : undefined);
  const coreDependencies = target ? lookup(CORE_PACKAGE, target.replace(/^\^/, ''))?.dependencies : undefined;
  if (target && !coreDependencies) {
    console.log(chalk.yellow(`  ! pnpm.overrides: 无法查询 zhin.js@${target} 的依赖，保留原值`));
  }

  let changed = false;
  for (const name of names) {
    const current = overrides[name];
    if (typeof current !== 'string' || isLocalOverride(current)) continue;
    const next = coreDependencies?.[name] ?? upgraded.get(name);
    if (next === undefined || next === current) continue;
    if (dryRun) console.log(chalk.cyan(`  [dry-run] pnpm.overrides.${name}: ${current} → ${next}`));
    else {
      overrides[name] = next;
      console.log(chalk.cyan(`  · pnpm.overrides.${name}: ${current} → ${next}`));
    }
    changed = true;
  }
  return changed;
}

/**
 * Directories the current scaffold creates and the runtime needs: `data/` (SQLite, uploads) and
 * `plugins/` (a `pnpm-workspace.yaml` package glob). Older migrate releases also created
 * `src/plugins`, which no scaffold or loader uses any more. Returns how many were (or would be) created.
 */
export const MIGRATE_PROJECT_DIRECTORIES: readonly string[] = Object.freeze(['data', 'plugins']);

export function ensureDirs(dir: string, dryRun: boolean): number {
  let created = 0;
  for (const d of MIGRATE_PROJECT_DIRECTORIES) {
    const full = path.join(dir, d);
    if (fs.existsSync(full)) continue;
    created++;
    if (dryRun) {
      console.log(chalk.cyan(`  [dry-run] 创建目录 ${d}/`));
    } else {
      fs.ensureDirSync(full);
      console.log(chalk.green(`  ✓ 已创建目录 ${d}/`));
    }
  }
  return created;
}

// ============================================================================
// Bootstrap file upgrade (SOUL.md, TOOLS.md, AGENTS.md)
// ============================================================================

const NEW_SOUL_MD = `# Soul

I am an action-oriented assistant living in chat channels.

## Personality

- Practical and helpful, with clear, natural replies.
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
`;

const NEW_TOOLS_MD = `# Tools Guide

Workspace-specific notes for installed tools belong here.
`;

const NEW_AGENTS_MD_HEADER = `# Agent Instructions

You are a helpful AI assistant. Keep your replies concise, accurate, and action-oriented.

## Guidelines

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
  const defaultRecords = `*(You can append here via write_file / write_memory.)*`;
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

/**
 * AI bootstrap files (SOUL.md / TOOLS.md / AGENTS.md). Files still on the old Chinese template are
 * upgraded (with a `.bak`); customized files are left alone. Missing files are created only for a
 * project that uses AI (`aiEnabled`) — the scaffold writes them only when AI is enabled, and a
 * project without AI never reads them. Returns how many files were (or would be) written.
 */
export function upgradeBootstrapFiles(dir: string, dryRun: boolean, aiEnabled = true): number {
  let upgraded = 0;
  const files = [
    { name: 'SOUL.md', build: (_existing?: string) => NEW_SOUL_MD },
    { name: 'TOOLS.md', build: (_existing?: string) => NEW_TOOLS_MD },
    // AGENTS.md keeps the user's preferences / records / TODO sections.
    { name: 'AGENTS.md', build: (existing?: string) => buildNewAgentsMd(existing) },
  ];

  for (const { name, build } of files) {
    const filePath = path.join(dir, name);
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, 'utf-8');
      if (!isOldChineseTemplate(existing)) {
        console.log(chalk.gray(`  · ${name} 已自定义，跳过`));
        continue;
      }
      if (dryRun) {
        console.log(chalk.cyan(`  [dry-run] ${name}: 升级为新模板（保留备份 ${name}.bak）`));
      } else {
        backupBeforeOverwrite(filePath);
        fs.writeFileSync(filePath, build(existing), 'utf-8');
        console.log(chalk.green(`  ✓ ${name} 已升级为新模板${name === 'AGENTS.md' ? '（保留了用户偏好、重要记录与待办）' : ''}，备份 ${name}.bak`));
      }
      upgraded++;
    } else if (aiEnabled) {
      if (dryRun) {
        console.log(chalk.cyan(`  [dry-run] ${name}: 创建`));
      } else {
        fs.writeFileSync(filePath, build(), 'utf-8');
        console.log(chalk.green(`  ✓ 已创建 ${name}`));
      }
      upgraded++;
    }
  }
  return upgraded;
}

/** The project uses AI: the config enables it, or package.json declares `@zhin.js/agent`. */
export async function projectUsesAi(dir: string, pkg: Record<string, any>): Promise<boolean> {
  if (pkg.dependencies?.['@zhin.js/agent'] || pkg.devDependencies?.['@zhin.js/agent']) return true;
  const configFile = findConfigFile(dir);
  if (!configFile) return false;
  try {
    return isAiEnabledInConfig(await readConfig(path.join(dir, configFile)) as Record<string, unknown>);
  } catch {
    return false;
  }
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

/**
 * Prints each declared Zhin package's installed version before → after the install (read from
 * node_modules). Returns true when one is missing or outside its declared range; each such row is
 * followed by the likely cause.
 */
export function reportInstalledVersions(
  dir: string,
  pkg: Record<string, any>,
  declared: Readonly<Record<string, string>>,
  before: ReadonlyMap<string, string | undefined>,
): boolean {
  const rows = compareInstalledVersions(dir, declared, before);
  if (rows.length === 0) return false;
  console.log(chalk.bold('  实际安装的版本（node_modules）：'));
  const lines = formatInstalledVersionRows(rows);
  let pnpmMajor: number | undefined | null = null;
  let behind = false;
  rows.forEach((row, index) => {
    console.log(lines[index]);
    if (row.status === 'ok' || row.status === 'unchecked') return;
    behind = true;
    if (row.status === 'missing') {
      console.log(chalk.red(`      未安装：在项目目录运行 pnpm install，并检查上方 pnpm 输出`));
      return;
    }
    if (pnpmMajor === null) pnpmMajor = detectPnpmMajor(dir);
    console.log(chalk.red(`      ${explainVersionMismatch(dir, pkg, row, pnpmMajor)}`));
  });
  console.log('');
  return behind;
}

export const migrateCommand = new Command('migrate')
  .description('升级项目依赖、scripts 与目录结构；v1 配置（缺少 configVersion: 2）请用 zhin migrate instances')
  .option('--dry-run', '仅打印将要执行的操作，不写入文件也不安装依赖', false)
  .option('--no-install', '跳过最后一步依赖安装')
  .option('--include-pinned', '把精确版本等已锁定的 zhin 依赖也升级到 registry 最新版本（精确版本保持精确；默认保留）', false)
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

    // 2. 目录结构：只补当前脚手架也会创建的目录
    console.log(chalk.bold.blue('2. 检查目录结构'));
    if (ensureDirs(cwd, dryRun) === 0) console.log(chalk.gray('  目录结构已与当前脚手架一致'));
    console.log('');

    // 3. AI 引导文件：只有使用 AI 的项目才需要
    const usesAi = await projectUsesAi(cwd, fs.readJsonSync(pkgPath));
    console.log(chalk.bold.blue('3. AI 引导文件（SOUL.md / TOOLS.md / AGENTS.md）'));
    const bootstrapCount = upgradeBootstrapFiles(cwd, dryRun, usesAi);
    if (bootstrapCount === 0) {
      console.log(chalk.gray(usesAi ? '  无需更新' : '  项目未启用 AI，不需要引导文件'));
    }
    console.log('');

    // 4. 安装依赖，并核对实际安装的版本
    let installFailed = false;
    let versionsBehind = false;
    if (installCommand) {
      console.log(chalk.bold.blue('4. 安装依赖'));
      const declared = declaredZhinDependencies(fs.readJsonSync(pkgPath));
      const before = snapshotInstalledVersions(cwd, Object.keys(declared));
      const ok = runInstall(cwd, dryRun, installCommand);
      console.log('');
      if (!dryRun) {
        installFailed = !ok;
        versionsBehind = reportInstalledVersions(cwd, fs.readJsonSync(pkgPath), declared, before);
      }
    }

    if (installFailed || versionsBehind) {
      process.exitCode = 1;
      console.log(chalk.bold.red(versionsBehind
        ? '✗ 迁移未完成：package.json 已更新，但上面标 ✗ 的包没有装上声明的版本（原因见各行说明）'
        : '✗ 迁移未完成：依赖安装失败，请按上方 pnpm 输出修复后在项目目录运行 pnpm install'));
      console.log('');
      return;
    }

    if (dryRun) console.log(chalk.bold.yellow('dry-run 结束：未写入任何文件，也未安装依赖。'));
    else console.log(chalk.bold.green('✅ 迁移完成'));
    console.log('');
    const legacy = await detectLegacyConfig(cwd);
    if (legacy.legacy) {
      // This command never rewrites config files; point to the dedicated converter.
      console.log(chalk.yellow('配置仍是 v1 格式，新版 Runtime 会拒绝启动。先停止 Bot，再运行：'));
      console.log(chalk.cyan('  zhin migrate instances') + chalk.gray('          预览改动'));
      console.log(chalk.cyan('  zhin migrate instances --apply') + chalk.gray('  应用（自动备份）'));
      console.log(chalk.gray(`  ${CONFIG_V2_MIGRATION_DOCS_URL}`));
      console.log('');
    }
    console.log(chalk.gray('下一步：'));
    console.log(chalk.cyan('  zhin doctor') + chalk.gray('  检查项目健康状况'));
    console.log(chalk.cyan('  pnpm dev') + chalk.gray('     启动开发模式'));
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


migrateCommand.addCommand(
  new Command('inference')
    .description('离线预览、迁移旧 AI 资源与 Session；不加载 .env 或启动 Bot')
    .option('--output <file>', '预览输出文件（包含密封源证明，不含明文凭据）')
    .option('--mapping <file>', '明确选择官方 Driver、协议与模型能力的 JSON 映射')
    .option('--sessions-only', '只将明确选中的旧 Session 绑定到现有 Profile；不加载 Driver 或凭据')
    .option('--state-snapshot <file>', '非 SQLite 数据库的显式旧元数据快照')
    .option('--database-config <file>', '离线数据库连接 JSON，不加载 .env')
    .option('--apply <file>', '应用已审查的预览；未知结果只查原操作回执')
    .option('--finalize <file>', '数据迁移确认后显式切换启动文件，保留原文备份')
    .option('--maintenance', '确认 Bot 已停止并处于维护期')
    .option('--backup-confirmed', '确认已备份原配置、数据库与加密主密钥')
    .option('--with-credentials', '授权读取预览列出的旧凭据并按原 owner 重封装')
    .action(
      async (options: {
        output?: string;
        mapping?: string;
        sessionsOnly?: boolean;
        stateSnapshot?: string;
        databaseConfig?: string;
        apply?: string;
        finalize?: string;
        maintenance?: boolean;
        backupConfirmed?: boolean;
        withCredentials?: boolean;
      }) => {
        if (options.apply && options.finalize) throw new Error('Choose apply or finalize');
        if (migrateCommand.opts().dryRun)
          throw new Error(
            'Inference migration does not support --dry-run; use --output for an explicit preview'
          );
        if (options.apply || options.finalize) {
          if (
            options.output ||
            options.mapping ||
            options.stateSnapshot ||
            options.databaseConfig ||
            options.sessionsOnly
          )
            throw new Error(
              'Apply the exact reviewed preview; do not replace its sources or mapping'
            );
          const previewFile = resolve(options.apply ?? options.finalize!);
          const kind: unknown = await fs.readJson(previewFile);
          if (kind && typeof kind === 'object' && 'mode' in kind && kind.mode === 'sessions') {
            if (options.finalize || options.withCredentials)
              throw new Error(
                'Session binding neither finalizes startup files nor imports credentials'
              );
            const sessions = await loadInferenceMigrationModule(
              async () => (await importProjectInstanceCli(process.cwd())).loadInferenceMigrationSessionBindings()
            );
            const preview = await sessions.readSessionBindingsPreview(previewFile);
            if (preview.rootId !== resolve(process.cwd()))
              throw new Error('Migration preview belongs to another project Root');
            const result = await sessions.applySessionBindings({
              preview,
              maintenance: !!options.maintenance,
              backupConfirmed: !!options.backupConfirmed,
            });
            console.log(JSON.stringify(result, null, 2));
            return;
          }
          const migration = await loadInferenceMigrationModule(
            async () => (await importProjectInstanceCli(process.cwd())).loadInferenceMigrationPreview()
          );
          const preview = await migration.readInferenceMigrationPreview(previewFile);
          if (preview.rootId !== resolve(process.cwd()))
            throw new Error('Migration preview belongs to another project Root');
          const writer = await loadInferenceMigrationModule(
            async () => (await importProjectInstanceCli(process.cwd())).loadInferenceMigrationApply()
          );
          const run = options.finalize
            ? writer.finalizeInferenceMigration
            : writer.applyInferenceMigration;
          const result = await run({
            preview,
            maintenance: !!options.maintenance,
            backupConfirmed: !!options.backupConfirmed,
            withCredentials: !!options.withCredentials,
          });
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        if (!options.output)
          throw new Error('Choose --output <preview.json> for a read-only source preview');
        if (options.mapping && /^\.env(?:\.|$)/u.test(path.basename(options.mapping)))
          throw new Error('Dotenv files are not migration mappings');
        let mapping;
        try {
          mapping = options.mapping ? await fs.readJson(resolve(options.mapping)) : undefined;
        } catch {
          throw new Error('Invalid migration mapping JSON');
        }
        const sources = {
          root: process.cwd(),
          ...(options.stateSnapshot ? { stateSnapshot: resolve(options.stateSnapshot) } : {}),
          ...(options.databaseConfig ? { databaseConfig: resolve(options.databaseConfig) } : {}),
        };
        if (options.sessionsOnly) {
          if (!mapping) throw new Error('Choose an explicit Session binding --mapping');
          if (options.withCredentials)
            throw new Error('Session binding does not import credentials');
          const sessions = await loadInferenceMigrationModule(
            async () => (await importProjectInstanceCli(process.cwd())).loadInferenceMigrationSessionBindings()
          );
          const preview = await sessions.previewSessionBindings({ ...sources, mapping });
          await fs.writeFile(resolve(options.output), `${JSON.stringify(preview, null, 2)}\n`, {
            flag: 'wx',
            mode: 0o600,
          });
          console.log(
            JSON.stringify(
              {
                id: preview.id,
                mode: preview.mode,
                output: resolve(options.output),
                stateSource: preview.stateSource,
                targetValidation: preview.targetValidation,
                sessions: preview.sessions.length,
              },
              null,
              2
            )
          );
          return;
        }
        const migration = await loadInferenceMigrationModule(
          async () => (await importProjectInstanceCli(process.cwd())).loadInferenceMigrationPreview()
        );
        const preview = await migration.previewInferenceMigration({
          ...sources,
          ...(mapping ? { mapping } : {}),
        });
        await fs.writeFile(resolve(options.output), `${JSON.stringify(preview, null, 2)}\n`, {
          flag: 'wx',
          mode: 0o600,
        });
        console.log(
          JSON.stringify(
            {
              id: preview.id,
              output: resolve(options.output),
              stateSource: preview.stateSource,
              units: preview.units.map((unit: any) => ({
                id: unit.id,
                ownerId: unit.ownerId,
                blocked: unit.migration.blocked,
              })),
              sessions: preview.sessions.length,
              blocked: preview.blocked,
            },
            null,
            2
          )
        );
      }
    )
);

async function loadInferenceMigrationModule<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') &&
      error instanceof Error &&
      error.message.includes('@zhin.js/agent')
    ) {
      throw new Error(
        'zhin migrate inference requires @zhin.js/agent to be installed (pnpm add @zhin.js/agent)',
        { cause: error }
      );
    }
    throw error;
  }
}
