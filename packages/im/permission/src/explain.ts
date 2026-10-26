import { checkBuiltinPermit, isPlatformPermit, parsePermitName, parsePlatformPermitName, type PermitKind } from './builtin.js';
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
  readonly kind: PermitKind | 'platform' | 'unknown';
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
      if (isPlatformPermit(rule)) return Object.freeze({ index, rule, kind: 'platform',
        outcome: parsePlatformPermitName(rule) ? 'not_evaluated' : 'mismatch',
        reason: permissionMessages(locale, parsePlatformPermitName(rule) ? 'uncheckedPlatform' : 'invalidPlatform') });
      return Object.freeze({ index, rule, kind: 'unknown', outcome: 'not_evaluated', reason: permissionMessages(locale, 'unknownRule') });
    }
    const { kind, values } = parsed;
    const known = kind === 'adapter' ? !!subject.adapter
      : kind === 'user' ? !!subject.sender?.id
      : kind === 'role' ? !!subject.sender?.id && options.rolesKnown === true
      : !!subject.scene;
    const missing = kind === 'role' ? 'missingRole' : kind === 'user' ? 'missingUser' : 'missingScene';
    return Object.freeze({ index, rule, kind, values: Object.freeze([...values]),
      outcome: known ? (checkBuiltinPermit(rule, subject) ? 'match' : 'mismatch') : 'unknown',
      reason: permissionMessages(locale, 'combination', { meaning: permissionMessages(locale, known ? kind : missing) }) });
  }));
}
