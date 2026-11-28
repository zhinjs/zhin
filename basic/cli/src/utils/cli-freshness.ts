/**
 * #1250 migrate-runs-installed-old-cli: `zhin migrate`'s rules ship with the CLI. `npx zhin migrate`
 * in a project runs the CLI that project installed — an older release rewrites the project by its
 * older rules (1.9.x added a `daemon` script and pinned `minimumReleaseAgeExclude` entries) and never
 * learns the newer ones. Migrate therefore compares the running CLI with the registry's latest
 * `@zhin.js/cli` (the release it is about to upgrade the project to) before it changes anything.
 */
import { readFileSync } from 'node:fs';
import { semver } from '../plugin-check/semver.js';
import { cachedRegistryLookup, npmRegistryLookup, type RegistryLookup } from './registry-version.js';

export const CLI_PACKAGE = '@zhin.js/cli';

/** The version of the CLI that is running (its own package.json), or undefined when unreadable. */
export function runningCliVersion(): string | undefined {
  try {
    const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    return typeof version === 'string' && semver.valid(version) ? version : undefined;
  } catch {
    return undefined;
  }
}

export type CliFreshness =
  | { readonly status: 'current'; readonly running: string; readonly latest: string }
  | { readonly status: 'outdated'; readonly running: string; readonly latest: string }
  /** Offline, an unreadable version, or a registry answer that is not a version. */
  | { readonly status: 'unknown'; readonly running?: string };

/** Whether the running CLI is older than the registry's latest `@zhin.js/cli`. */
export function checkCliFreshness(
  options: { readonly lookup?: RegistryLookup; readonly running?: string } = {},
): CliFreshness {
  const running = 'running' in options ? options.running : runningCliVersion();
  if (!running || !semver.valid(running)) return { status: 'unknown' };
  const latest = cachedRegistryLookup(options.lookup ?? npmRegistryLookup)(CLI_PACKAGE)?.version;
  if (!latest || !semver.valid(latest)) return { status: 'unknown', running };
  return semver.gt(latest, running) ? { status: 'outdated', running, latest } : { status: 'current', running, latest };
}

/**
 * What to do about an outdated CLI, one line each. Advice only (#1250 b116 M3): migrate never stops
 * here — a project may lock an exact CLI on purpose, and pnpm's `minimumReleaseAge` may keep a fresh
 * release out of the project for days (CI would fail after every release otherwise).
 */
export function formatOutdatedCliAdvice(freshness: Extract<CliFreshness, { status: 'outdated' }>): string[] {
  return [
    `  ! 正在运行的 ${CLI_PACKAGE} 是 ${freshness.running}，registry 最新版本是 ${freshness.latest}。`,
    '    迁移规则随 CLI 发布：旧 CLI 会按旧规则改写项目，也不会清理旧版多写的内容。',
    '    建议用最新 CLI 执行迁移（不需要先改项目）：',
    `      npx ${CLI_PACKAGE}@latest migrate        （或 pnpm dlx ${CLI_PACKAGE}@latest migrate）`,
    `    也可以先把项目里的 CLI 升到最新再运行 npx zhin migrate：pnpm add ${CLI_PACKAGE}@latest`,
    '    项目启用了 minimumReleaseAge 时，刚发布的版本可能装不进项目，这时请用上面的 npx / pnpm dlx。',
    '    下面按当前 CLI 的规则继续。',
  ];
}
