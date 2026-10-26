import { operationClientAdapter } from '@zhin.js/feature-kit';
import { explainPermitRules, toPermissionSubject, type PermissionSubject, type PermissionConditionExplanation } from '@zhin.js/permission';
import { resolveCommandSender, resolveCommandSession, type CommandMessage } from './definition.js';
import type { CommandDescriptor } from './command-index.js';
import { resolveLocale, type Locale } from '@zhin.js/plugin-runtime';
import { commandMessages } from './messages.js';

/** The exact subject projection used by the real command permit gate. No factories or checkers run. */
export function toCommandPermissionSubject(source: unknown): PermissionSubject {
  const projected = toPermissionSubject(source);
  const session = resolveCommandSession(source);
  return { ...projected, ...session, ...(session.sender ? { sender: { ...projected.sender, ...session.sender } } : {}) };
}

/** Exact authoring adapter restriction, distinct from builtin adapter(...) matching. */
export function commandAdapterMatches(command: Readonly<{ adapter?: string }>, source: unknown): boolean {
  return !command.adapter || operationClientAdapter(source) === command.adapter;
}

export type CommandPermissionHostStatus = 'present' | 'missing' | 'unverified';

/** Read-only hypothetical conditions. A match is not permission to execute the command. */
export function explainCommandPermissions(
  command: Pick<CommandDescriptor, 'adapter' | 'permit'>,
  options: Readonly<{ source?: unknown; rolesKnown?: boolean; permissionHost: CommandPermissionHostStatus; locale?: Locale }>,
) {
  const locale = resolveLocale(options.locale);
  const projected = toCommandPermissionSubject(options.source);
  const inputSender = options.source && typeof options.source === 'object'
    ? (options.source as Pick<CommandMessage, 'sender'>).sender : undefined;
  const structuredRoles = inputSender && typeof inputSender === 'object'
    && Array.isArray((inputSender as { readonly role?: unknown }).role);
  // A sender-only assumption has no synthetic conversation. Apply the real canonical
  // sender defaults without inventing an Endpoint or treating unknown roles as known.
  const senderOnly = options.source && typeof options.source === 'object' && !('conversation' in options.source) && !structuredRoles
    ? resolveCommandSender(options.source as Pick<CommandMessage, 'sender'>, undefined) : undefined;
  const subject = senderOnly ? { ...projected, sender: senderOnly } : projected;
  const defaultedRoles = options.rolesKnown && Array.isArray(inputSender?.roles) && inputSender.roles.length === 0
    && subject.sender?.role.length === 1 && subject.sender.role[0] === 'user';
  const actualAdapter = operationClientAdapter(options.source);
  const adapter: PermissionConditionExplanation = !command.adapter
    ? { outcome: 'not_evaluated', reason: commandMessages(locale, 'noAdapter') }
    : !actualAdapter ? { outcome: 'unknown', reason: commandMessages(locale, 'missingEndpoint') }
      : { outcome: commandAdapterMatches(command, options.source) ? 'match' : 'mismatch', reason: commandMessages(locale, 'adapterComparison') };
  const rules = explainPermitRules(command.permit ?? [], subject, { rolesKnown: options.rolesKnown, locale });
  const conditions = [...(command.adapter ? [adapter] : []), ...rules];
  let summary: PermissionConditionExplanation;
  if (conditions.some(item => item.outcome === 'mismatch')) summary = { outcome: 'mismatch', reason: commandMessages(locale, 'conditionMismatch') };
  else if ((rules.length > 0 && options.permissionHost !== 'present') || conditions.some(item => item.outcome === 'unknown')) {
    summary = { outcome: 'unknown', reason: rules.length > 0 && options.permissionHost !== 'present'
      ? commandMessages(locale, 'missingPermissionHost') : commandMessages(locale, 'missingEvidence') };
  } else if (rules.length === 0) summary = { outcome: 'not_evaluated', reason: commandMessages(locale, 'noPermit') };
  else if (conditions.some(item => item.outcome === 'not_evaluated')) summary = { outcome: 'not_evaluated', reason: commandMessages(locale, 'uncheckedConditions') };
  else summary = { outcome: 'match', reason: commandMessages(locale, 'conditionsMatch') };
  return Object.freeze({ permissionHost: options.permissionHost, adapter: Object.freeze(adapter), rules, summary: Object.freeze(summary),
    unconstrained: Object.freeze([commandMessages(locale, 'unconstrained')]),
    assumptions: Object.freeze([commandMessages(locale, 'simulatedIdentity'), commandMessages(locale, 'unevaluatedCode'),
      ...(defaultedRoles
        ? [commandMessages(locale, 'defaultedRole')] : [])]),
  });
}
