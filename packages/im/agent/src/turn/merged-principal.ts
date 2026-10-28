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
import type { TurnAccessContext } from './turn-ingress.js';

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

function intersect(base: readonly string[], others: readonly (readonly string[])[]): string[] {
  const sets = others.map((values) => new Set(values));
  return [...new Set(base)].filter((value) => sets.every((set) => set.has(value)));
}
