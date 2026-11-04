/**
 * ADR 0048 §3.4 invariant 1 — authority is only ever attenuated.
 *
 * Effective authority of a delegatee = delegator authority ∩ the narrowing
 * declared at hand-off ∩ the delegatee agent's ceiling. Every function here is
 * pure: inputs are never mutated and every returned object is frozen.
 */
import {
  ALL,
  TRUST_LEVELS,
  intersectScopes,
  scopeHas,
  scopeWithin,
  type ActorId,
  type AgentCeiling,
  type AgentName,
  type Authority,
  type AuthorityNarrowing,
  type EgressScope,
  type NameScope,
  type Principal,
  type TrustLevel,
} from './contracts.js';

// ---------------------------------------------------------------------------
// Trust
// ---------------------------------------------------------------------------

function trustRank(level: TrustLevel): number {
  const rank = TRUST_LEVELS.indexOf(level);
  if (rank < 0) throw new TypeError(`Unknown trust level: ${String(level)}`);
  return rank;
}

function isTrustLevel(value: unknown): value is TrustLevel {
  return typeof value === 'string' && (TRUST_LEVELS as readonly string[]).includes(value);
}

/** Negative when `a` is lower than `b`, 0 when equal, positive when higher. Throws on unknown levels. */
export function compareTrust(a: TrustLevel, b: TrustLevel): number {
  return trustRank(a) - trustRank(b);
}

/** The lowest of the given levels. Throws when called with none. */
export function minTrust(...levels: readonly TrustLevel[]): TrustLevel {
  if (levels.length === 0) throw new TypeError('minTrust requires at least one level');
  let lowest = levels[0];
  for (const level of levels) {
    if (compareTrust(level, lowest) < 0) lowest = level;
  }
  trustRank(lowest);
  return lowest;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function freezeScope(scope: NameScope): NameScope {
  return intersectScopes(scope, ALL);
}

function freezePrincipal(principal: Principal): Principal {
  return Object.freeze({
    kind: principal.kind,
    id: principal.id,
    trust: principal.trust,
    ...(principal.venue ? { venue: Object.freeze({ kind: principal.venue.kind, id: principal.venue.id }) } : {}),
  });
}

function freezeEgress(network: boolean, hosts: NameScope): EgressScope {
  return Object.freeze({ network, hosts: freezeScope(hosts) });
}

function dedupe(ids: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(ids)]);
}

/**
 * Authority of an engagement's root mail: what the principal may do through
 * this agent. Approvers are the human principal first, then configured ids.
 */
export function rootAuthority(
  principal: Principal,
  ceiling: AgentCeiling,
  options: { readonly approvers?: readonly string[] } = {},
): Authority {
  const approvers = [...(principal.kind === 'human' ? [principal.id] : []), ...(options.approvers ?? [])];
  return Object.freeze({
    principal: freezePrincipal(principal),
    trust: minTrust(principal.trust, ceiling.maxTrust),
    tools: freezeScope(ceiling.tools),
    contacts: freezeScope(ceiling.contacts),
    egress: freezeEgress(ceiling.egress.network, ceiling.egress.hosts),
    approvers: dedupe(approvers),
    chain: Object.freeze([]) as readonly ActorId[],
  });
}

/**
 * Derives the authority handed to `target` by actor `via`. Never widens: a
 * narrowing asking for more than the parent just gets the intersection.
 * Principal and approvers are carried over unchanged.
 */
export function attenuate(
  parent: Authority,
  narrowing: AuthorityNarrowing,
  target: AgentCeiling,
  via: ActorId,
): Authority {
  const tools = intersectScopes(intersectScopes(parent.tools, narrowing.tools ?? ALL), target.tools);
  const contacts = intersectScopes(intersectScopes(parent.contacts, narrowing.contacts ?? ALL), target.contacts);
  const trust = minTrust(parent.trust, narrowing.trust ?? parent.trust, target.maxTrust);
  const network = parent.egress.network && (narrowing.egress?.network ?? true) && target.egress.network;
  const hosts = intersectScopes(
    intersectScopes(parent.egress.hosts, narrowing.egress?.hosts ?? ALL),
    target.egress.hosts,
  );
  return Object.freeze({
    principal: freezePrincipal(parent.principal),
    trust,
    tools,
    contacts,
    egress: freezeEgress(network, hosts),
    approvers: Object.freeze([...parent.approvers]),
    chain: Object.freeze([...parent.chain, via]),
  });
}

// ---------------------------------------------------------------------------
// Verification (called by the guard kernel)
// ---------------------------------------------------------------------------

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a).filter((key) => (a as Record<string, unknown>)[key] !== undefined);
  const bKeys = Object.keys(b).filter((key) => (b as Record<string, unknown>)[key] !== undefined);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      sameJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * `true` iff `child` is a single, valid attenuation step from `parent`:
 * same principal and approvers, no wider trust / tools / contacts / egress,
 * and a chain that extends the parent's by exactly one actor.
 */
export function isAttenuationOf(child: Authority, parent: Authority): boolean {
  if (!isTrustLevel(child.trust) || !isTrustLevel(parent.trust)) return false;
  if (!isTrustLevel(child.principal.trust)) return false;
  if (!sameJson(child.principal, parent.principal)) return false;
  if (!sameList(child.approvers, parent.approvers)) return false;
  if (compareTrust(child.trust, parent.trust) > 0) return false;
  if (compareTrust(child.trust, child.principal.trust) > 0) return false;
  if (!scopeWithin(child.tools, parent.tools)) return false;
  if (!scopeWithin(child.contacts, parent.contacts)) return false;
  if (child.egress.network && !parent.egress.network) return false;
  if (!scopeWithin(child.egress.hosts, parent.egress.hosts)) return false;
  if (child.chain.length !== parent.chain.length + 1) return false;
  return parent.chain.every((actor, index) => child.chain[index] === actor);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Agent name of an actor id: the part before `#`. */
export function agentOf(actor: ActorId): AgentName {
  const hash = actor.indexOf('#');
  return hash < 0 ? actor : actor.slice(0, hash);
}

export function canCall(authority: Authority, tool: string): boolean {
  return scopeHas(authority.tools, tool);
}

/** Takes an agent name; use `agentOf(actor)` for actor ids. */
export function canContact(authority: Authority, agentName: AgentName): boolean {
  return scopeHas(authority.contacts, agentName);
}

export function allowsHost(authority: Authority, host: string): boolean {
  return authority.egress.network && scopeHas(authority.egress.hosts, host);
}
