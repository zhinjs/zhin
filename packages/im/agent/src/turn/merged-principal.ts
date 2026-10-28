/**
 * ADR 0038 §2 — the principal of a merged turn is a set, not one person.
 *
 * A merged turn answers several group members at once. It may only do what
 * **every** member may do: capabilities are the intersection of what each
 * member sees on their own, and the turn's roles / permissions are the
 * intersection of theirs (the "lowest" member). Merging can therefore only
 * narrow what the turn can do, never widen it — a moderator in the window
 * does not lend their tools to a plain member.
 *
 * Masters never join a merge window (ADR 0038 §0.3), so master-only
 * capabilities never survive the intersection either.
 */

import type { AgentCapabilities } from '../plugin-runtime/capability-ingress.js';
import type { TurnAccessContext, TurnMergedMember } from './turn-ingress.js';

/**
 * The carrier's access narrowed to what all members share. Origin and subject
 * stay the carrier's (session, reply target and audit need one anchor); roles
 * and permissions keep only entries every member holds.
 */
export function narrowMergedAccess(
  carrier: TurnAccessContext,
  members: readonly TurnAccessContext[],
): TurnAccessContext {
  const others = members.filter((member) => member !== carrier);
  if (others.length === 0) return carrier;
  const roles = intersect(carrier.principal.roles, others.map((member) => member.principal.roles));
  const permissions = intersect(carrier.policy.permissions, others.map((member) => member.policy.permissions));
  return Object.freeze({
    ...carrier,
    principal: Object.freeze({ ...carrier.principal, roles: Object.freeze(roles) }),
    policy: Object.freeze({
      ...carrier.policy,
      permissions: Object.freeze(permissions),
      // One unattended member makes the whole turn unattended.
      unattended: carrier.policy.unattended || others.some((member) => member.policy.unattended),
    }),
  });
}

/**
 * Keeps the carrier's bound capabilities that every member could also see.
 * Tools, skills and agents are matched by their qualified name; MCP servers
 * and prompt sections carry no per-sender permission and stay as read.
 */
export function intersectCapabilities(
  carrier: AgentCapabilities,
  members: readonly AgentCapabilities[],
): AgentCapabilities {
  const others = members.filter((member) => member !== carrier);
  if (others.length === 0) return carrier;
  const keep = <T>(items: readonly T[], key: (item: T) => string, pick: (member: AgentCapabilities) => readonly T[]) => {
    const shared = others.map((member) => new Set(pick(member).map(key)));
    return Object.freeze(items.filter((item) => shared.every((names) => names.has(key(item)))));
  };
  return Object.freeze({
    ...carrier,
    tools: keep(carrier.tools, (tool) => tool.name, (member) => member.tools),
    skills: keep(carrier.skills, (skill) => skill.qualifiedName, (member) => member.skills),
    agents: keep(carrier.agents, (agent) => agent.qualifiedName, (member) => member.agents),
  });
}

/** A display name that two senders share names neither of them. */
function onlyOne<T>(items: readonly T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined;
}

function intersect(base: readonly string[], others: readonly (readonly string[])[]): string[] {
  const sets = others.map((values) => new Set(values));
  return [...new Set(base)].filter((value) => sets.every((set) => set.has(value)));
}

/**
 * Attaches the per-sender Tool lists a merged turn needs for `onBehalfOf`
 * re-checks (ADR 0038 §2). `members` and `tools` line up by index; a sender
 * listed twice keeps only the Tools both entries allow.
 */
export function withMergeMembers(
  access: TurnAccessContext,
  members: readonly TurnAccessContext[],
  tools: readonly (readonly string[])[],
): TurnAccessContext {
  const bySubject = new Map<string, TurnMergedMember>();
  members.forEach((member, index) => {
    const subjectId = member.principal.subjectId;
    const own = tools[index] ?? [];
    const seen = bySubject.get(subjectId);
    bySubject.set(subjectId, Object.freeze({
      subjectId,
      ...(seen?.displayName ?? member.principal.displayName
        ? { displayName: seen?.displayName ?? member.principal.displayName }
        : {}),
      tools: Object.freeze(seen ? seen.tools.filter((name) => own.includes(name)) : [...new Set(own)]),
    }));
  });
  return Object.freeze({
    ...access,
    policy: Object.freeze({
      ...access.policy,
      merge: Object.freeze({ members: Object.freeze([...bySubject.values()]) }),
    }),
  });
}

/** Reserved argument a merged turn's side-effect calls carry (ADR 0038 §2). */
export const ON_BEHALF_OF_ARG = 'onBehalfOf';

export type OnBehalfOfResolution =
  | Readonly<{ status: 'allowed'; member: TurnMergedMember; fallback: boolean }>
  | Readonly<{ status: 'denied'; reason: string; fallback: boolean; subjectId?: string }>;

/**
 * Re-checks one side-effect call against the sender it acts for.
 *
 * `onBehalfOf` names a sender of the merge by subject id (or, failing that,
 * by a display name no other sender shares). A missing or unknown sender falls back to the
 * lowest member: the call passes only if every member could make it.
 */
export function resolveOnBehalfOf(
  merge: NonNullable<TurnAccessContext['policy']['merge']>,
  toolName: string,
  onBehalfOf: unknown,
): OnBehalfOfResolution {
  const named = typeof onBehalfOf === 'string' ? onBehalfOf.trim() : '';
  const member = named
    ? merge.members.find((entry) => entry.subjectId === named)
      ?? onlyOne(merge.members.filter((entry) => entry.displayName === named))
    : undefined;
  if (member) {
    return member.tools.includes(toolName)
      ? Object.freeze({ status: 'allowed', member, fallback: false })
      : Object.freeze({ status: 'denied', reason: `${member.subjectId} may not use ${toolName}`, fallback: false, subjectId: member.subjectId });
  }
  const lacking = merge.members.find((entry) => !entry.tools.includes(toolName));
  if (lacking || merge.members.length === 0) {
    return Object.freeze({
      status: 'denied',
      reason: `${named ? `unknown onBehalfOf "${named}"` : 'missing onBehalfOf'}; not every sender may use ${toolName}`,
      fallback: true,
      ...(lacking ? { subjectId: lacking.subjectId } : {}),
    });
  }
  // Every member may make the call; attribute it to the turn's first sender.
  return Object.freeze({ status: 'allowed', member: merge.members[0]!, fallback: true });
}
