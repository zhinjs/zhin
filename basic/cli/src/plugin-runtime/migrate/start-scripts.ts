/**
 * Start scripts a migrated project gets (ADR 0054 §6), the same as `create-zhin-app`: `zhin start`
 * is the entry; `zhin runtime start` stays an accepted alias of `zhin start --foreground` and is
 * never rewritten. No `daemon` script: the scaffold has none (`zhin start` alone runs in the
 * background; #1250).
 */
export const RECOMMENDED_START_SCRIPTS = Object.freeze({
  dev: 'zhin start --foreground --watch source config',
  // Foreground: containers, systemd units and PM2 own the process.
  start: 'zhin start --foreground --mode production --no-watch',
} as const);

/**
 * Every script `zhin migrate` adds to a project that lacks it: exactly the scripts of a new
 * `create-zhin-app` project (`packages/toolkit/create-zhin/src/scripts.ts`, compared by a test).
 * Existing scripts are kept unless they are a legacy form ({@link LEGACY_PROJECT_SCRIPTS}).
 */
export const RECOMMENDED_PROJECT_SCRIPTS: Readonly<Record<string, string>> = Object.freeze({
  ...RECOMMENDED_START_SCRIPTS,
  stop: 'zhin stop',
  preview: 'zhin preview',
  build: 'tsc --noEmit',
});

/**
 * Pre-gateway scripts replaced on migration. `zhin dev` is the link / unlink tool now. A bare
 * `zhin start` (or `zhin start --daemon`) in `start` / `dev` used to stay attached; `zhin start`
 * runs in the background by default now, so a container / PM2 / systemd `Type=simple` service
 * would exit immediately — those exact scripts are rewritten to the foreground recommendation.
 */
export const LEGACY_START_SCRIPTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  dev: Object.freeze(['zhin dev', 'zhin start', 'zhin start --daemon']),
  start: Object.freeze(['zhin start', 'zhin start --daemon']),
});

/** Legacy forms `zhin migrate` rewrites in a project. */
export const LEGACY_PROJECT_SCRIPTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ...LEGACY_START_SCRIPTS,
  build: Object.freeze(['zhin build']),
});

/**
 * Scripts older CLIs added that the scaffold no longer has (#1250 migrate-runs-installed-old-cli):
 * `zhin migrate` 1.9.x wrote `daemon`. Removed only while the value is exactly what that CLI wrote
 * (whitespace aside); a script the user changed is theirs and stays.
 */
export const REMOVED_PROJECT_SCRIPTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  daemon: Object.freeze(['zhin start --mode production --no-watch']),
});

function normalizeScript(script: string): string {
  return script.trim().replace(/\s+/gu, ' ');
}

/** Whether `script` is one of the exact legacy forms of `name` that migration rewrites. */
export function isLegacyScript(
  legacy: Readonly<Record<string, readonly string[]>>,
  name: string,
  script: unknown,
): boolean {
  return typeof script === 'string' && (legacy[name] ?? []).includes(normalizeScript(script));
}

/** `zhin start …` or its alias `zhin runtime start …`. */
export function isAcceptedStartScript(script: unknown): boolean {
  return typeof script === 'string' && /^zhin (?:start|runtime start)(?:\s|$)/u.test(script.trim());
}

/**
 * A script a process manager can own: `zhin runtime start …` (always foreground) or
 * `zhin start … --foreground` / `-f`. Plain `zhin start` returns once the gateway is up.
 */
export function isForegroundStartScript(script: unknown): boolean {
  if (typeof script !== 'string') return false;
  const normalized = normalizeScript(script);
  if (/^zhin runtime start(?: |$)/u.test(normalized)) return true;
  if (!/^zhin start(?: |$)/u.test(normalized)) return false;
  // Only the zhin invocation itself (stop at shell operators).
  const command = normalized.split(/\s*(?:&&|\|\||;|\|)\s*/u)[0]!;
  return command.split(' ').some((arg) => arg === '--foreground' || arg === '-f');
}
