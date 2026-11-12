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

/** Pre-gateway scripts replaced on migration (`zhin dev` is the link / unlink tool now). */
export const LEGACY_START_SCRIPTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  dev: Object.freeze(['zhin dev']),
});

/** `zhin start …` or its alias `zhin runtime start …`. */
export function isAcceptedStartScript(script: unknown): boolean {
  return typeof script === 'string' && /^zhin (?:start|runtime start)(?:\s|$)/u.test(script.trim());
}
