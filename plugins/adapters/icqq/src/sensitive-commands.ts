import type { SensitiveExecCommandRule } from '@zhin.js/agent';

/**
 * The `icqq` command-line client can kick members, move money and delete files. Under an `allowlist`
 * exec policy its non-sensitive subcommands run freely, while these need owner approval (ADR 0044:
 * this knowledge lives with the adapter, the exec policy only reads the registered rule).
 */
export const ICQQ_SENSITIVE_SUBCOMMAND_REGEXES: readonly RegExp[] = Object.freeze([
  /\bicqq\s+friend\s+(?:delete|block|move)\b/i,
  /\bicqq\s+group\s+(?:kick|mute|set|admin|announce|transfer|quit|dissolve|invite)\b/i,
  /\bicqq\s+(?:request|wallet|pay|recall)\b/i,
  /\bicqq\s+file\s+(?:upload|delete)\b/i,
  /\bicqq\s+gfs\b.*\b(?:rm|delete|del)\b/i,
]);

export const icqqSensitiveExecRule: SensitiveExecCommandRule = Object.freeze({
  command: 'icqq',
  sensitive: ICQQ_SENSITIVE_SUBCOMMAND_REGEXES,
});
