import { BOT_PERMIT_KINDS, checkBuiltinPermit, parsePermitName, removedPermitReplacement, type PermitKind } from './builtin.js';
import type { PermissionSubject } from './subject.js';
import { resolveLocale, type Locale } from '@zhin.js/plugin-runtime';
import { permissionMessages } from './messages.js';

/** A simulation of declared conditions, never an authorization decision. */
export type PermissionExplanationOutcome = 'match' | 'mismatch' | 'unknown' | 'not_evaluated';
export interface PermissionConditionExplanation {
  readonly outcome: PermissionExplanationOutcome;
  readonly reason: string;
}
export interface PermitRuleExplanation extends PermissionConditionExplanation {
  readonly index: number;
  readonly rule: string;
  readonly kind: PermitKind | 'unknown';
  readonly values?: readonly string[];
}

/** Pure builtin interpretation. Does not resolve or execute any registered checker. */
export function explainPermitRules(
  permits: readonly string[],
  subject: PermissionSubject = {},
  options: Readonly<{ rolesKnown?: boolean; locale?: Locale }> = {},
): readonly PermitRuleExplanation[] {
  const locale = resolveLocale(options.locale);
  return Object.freeze(permits.map((rule, index): PermitRuleExplanation => {
    const parsed = parsePermitName(rule);
    if (!parsed) {
      const replacement = removedPermitReplacement(rule);
      return Object.freeze({ index, rule, kind: 'unknown', outcome: replacement ? 'mismatch' : 'not_evaluated',
        reason: replacement ? `${rule} → ${replacement}` : permissionMessages(locale, 'unknownRule') });
    }
    const { kind, values } = parsed;
    const roleKind = kind === 'role' || kind === 'platform' || kind === 'platform-role' || kind === 'platform-permission';
    const botKind = BOT_PERMIT_KINDS.has(kind);
    const known = kind === 'adapter' ? !!subject.adapter
      : kind === 'user' ? !!subject.sender?.id
      : roleKind ? !!subject.sender?.id && options.rolesKnown === true
      : botKind ? !!subject.bot
      : !!subject.scene;
    const missing = kind === 'role' ? 'missingRole' : roleKind ? 'missingPlatform' : botKind ? 'missingBot' : kind === 'user' ? 'missingUser' : 'missingScene';
    return Object.freeze({ index, rule, kind, values: Object.freeze([...values]),
      outcome: known ? (checkBuiltinPermit(rule, subject) ? 'match' : 'mismatch') : 'unknown',
      reason: permissionMessages(locale, 'combination', { meaning: permissionMessages(locale, known ? kind : missing) }) });
  }));
}

/**
 * One sentence telling the sender which condition a denied permit needs (command / button
 * rejection replies). Session conditions stay generic.
 */
export function describeDeniedPermit(permit: string, locale?: Locale): string {
  const resolved = resolveLocale(locale);
  const parsed = parsePermitName(permit);
  if (!parsed) return permissionMessages(resolved, 'deniedGeneric');
  const value = parsed.values.join(', ');
  switch (parsed.kind) {
    case 'role': return permissionMessages(resolved, 'deniedRole', { value });
    case 'platform': return permissionMessages(resolved, parsed.values[0] === 'owner' ? 'deniedPlatformOwner' : 'deniedPlatformAdmin');
    case 'platform-role': return permissionMessages(resolved, 'deniedPlatformRole', { value });
    case 'platform-permission': return permissionMessages(resolved, 'deniedPlatformPermission', { value });
    case 'bot': return permissionMessages(resolved, parsed.values[0] === 'owner' ? 'deniedBotOwner' : 'deniedBotAdmin');
    case 'bot-role': return permissionMessages(resolved, 'deniedBotRole', { value });
    case 'bot-permission': return permissionMessages(resolved, 'deniedBotPermission', { value });
    case 'user': return permissionMessages(resolved, 'deniedUser');
    default: return permissionMessages(resolved, 'deniedScene');
  }
}
