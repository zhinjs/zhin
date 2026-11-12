/**
 * Start scripts a migrated project gets (ADR 0054 §6), matching `create-zhin-app`: `zhin start`
 * is the entry; `zhin runtime start` stays an accepted alias of `zhin start --foreground` and is
 * never rewritten.
 */
export const RECOMMENDED_START_SCRIPTS = Object.freeze({
  dev: 'zhin start --foreground --watch source config',
  // Foreground: containers, systemd units and PM2 own the process.
  start: 'zhin start --foreground --mode production --no-watch',
  daemon: 'zhin start --mode production --no-watch',
} as const);

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
