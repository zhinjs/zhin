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

/** Options of the denial sentences: the sender's normalized platform standing, when known. */
export interface PermitDenialOptions {
  /** `sender.platform.standing`: a group owner / admin learns that it is not a zhin role. */
  readonly standing?: string;
  /** A platform / Bot condition's reason the caller already described (the command index's denial). */
  readonly reason?: string;
  /**
   * The chat invocation of the `bind` command where the refusal is sent. Kept for callers; no longer
   * read since `绑定 <码>` works without the command prefix (#1250), so the text names the bare word.
   */
  readonly bindCommand?: string;
  /** The endpoint's command prefix; kept for callers, no longer read (see {@link bindCommand}). */
  readonly commandPrefix?: string;
  /**
   * #1250 owner-hints-dead-end-sandbox-only: only local simulation adapters are loaded (the caller
   * reads it from capability profiles, `isSimulationOnlyAdapterIndex` in `@zhin.js/adapter`). Bind and
   * claim codes never work there, so a global owner is made through the Sandbox's
   * 「以我的聊天身份发言」 identity instead.
   */
  readonly simulationOnly?: boolean;
}

/** Joins sentences: no separator after full-width punctuation, a space in English. */
function sentences(locale: Locale, ...parts: readonly string[]): string {
  return parts.join(locale === 'en' ? ' ' : '');
}

/** Whether every value of a role permit is `owner@global` (a host-wide ability). */
function requiresGlobalOwner(values: readonly string[]): boolean {
  return values.length > 0 && values.every((value) => value === 'owner@global');
}

/** Where a global owner is granted (#1250: `绑定 <码>` needs no command prefix; a Sandbox-only project uses the Sandbox identity). */
function globalOwnerGrant(locale: Locale, options: Pick<PermitDenialOptions, 'bindCommand' | 'commandPrefix' | 'simulationOnly'>): string {
  if (options.simulationOnly === true) return permissionMessages(locale, 'globalOwnerGrantSimulation');
  return permissionMessages(locale, 'globalOwnerGrant', { bind: permissionMessages(locale, 'bindWord') });
}

function roleDenial(values: readonly string[], locale: Locale, options: PermitDenialOptions): string {
  if (requiresGlobalOwner(values)) return sentences(locale, permissionMessages(locale, 'deniedGlobalOwner'), globalOwnerGrant(locale, options));
  return permissionMessages(locale, options.standing === 'owner' || options.standing === 'admin' ? 'deniedRoleStanding' : 'deniedRole');
}

/**
 * Complete sentences telling the sender which condition a denied permit needs (button refusals,
 * `CommandDispatchResult.denial.reason`, a Root command feedback renderer's `reason`). zhin role
 * conditions say where roles come from, never which role (ADR 0060 §5.3); `owner@global` says how a
 * global owner is granted. Session conditions stay generic. Only {@link describeCommandDenial}
 * prepends the command refusal to them.
 */
export function describeDeniedPermit(permit: string, locale?: Locale, options: PermitDenialOptions = {}): string {
  const resolved = resolveLocale(locale);
  const parsed = parsePermitName(permit);
  if (!parsed) return permissionMessages(resolved, 'deniedGeneric');
  const value = parsed.values.join(', ');
  switch (parsed.kind) {
    case 'role': return roleDenial(parsed.values, resolved, options);
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

/**
 * The reply to a command refused for `permit` (zhinjs/zhin#1250 第 78 批: the one source of command
 * refusals). A zhin role condition says where roles come from (`owner@global`: how a global owner
 * is granted, the same text as {@link describeGlobalOwnerRequired}); a platform / Bot condition says
 * what is missing; `private()` asks for a private chat; anything else (no permit, another place
 * condition, a user list, a custom permit) is the generic sentence.
 */
export function describeCommandDenial(permit: string | undefined, locale?: Locale, options: PermitDenialOptions = {}): string {
  const resolved = resolveLocale(locale);
  if (typeof permit !== 'string') return permissionMessages(resolved, 'deniedCommand');
  const parsed = parsePermitName(permit);
  if (!parsed) return permissionMessages(resolved, 'deniedCommand');
  if (parsed.kind === 'role') {
    return requiresGlobalOwner(parsed.values) ? describeGlobalOwnerRequired(resolved, options)
      : sentences(resolved, permissionMessages(resolved, 'deniedCommand'), roleDenial(parsed.values, resolved, options));
  }
  if (parsed.kind === 'private' && parsed.values.every((value) => value === '' || value === '*')) return permissionMessages(resolved, 'deniedPrivate');
  if (parsed.kind === 'platform' || parsed.kind === 'platform-role' || parsed.kind === 'platform-permission' || BOT_PERMIT_KINDS.has(parsed.kind)) {
    return sentences(resolved, permissionMessages(resolved, 'deniedCommandHere'), options.reason || describeDeniedPermit(permit, resolved));
  }
  return permissionMessages(resolved, 'deniedCommand');
}

/**
 * The refusal of a host-wide ability that needs a **global** chat owner (ADR 0056 §2: restart,
 * configuration, owner approvals, `owner@global` permits), with where a global owner is granted.
 * `privateChat`: the ability also needs a private chat; `bindCommand` / `commandPrefix` / `simulationOnly`: as in {@link PermitDenialOptions}.
 */
export function describeGlobalOwnerRequired(locale?: Locale, options: Readonly<{ privateChat?: boolean; bindCommand?: string; commandPrefix?: string; simulationOnly?: boolean }> = {}): string {
  const resolved = resolveLocale(locale);
  return sentences(resolved, permissionMessages(resolved, options.privateChat ? 'globalOwnerPrivateOnly' : 'globalOwnerOnly'), globalOwnerGrant(resolved, options));
}

/**
 * The refusal of a conversation-management action guarded by `canManageConversation` (`@zhin.js/command`):
 * a private chat, or the zhin chat role `admin` of the conversation.
 */
export function describeConversationManagerDenial(locale?: Locale): string {
  return permissionMessages(resolveLocale(locale), 'deniedConversationManager');
}
