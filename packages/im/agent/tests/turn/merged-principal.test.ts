import { describe, expect, it } from 'vitest';
import { intersectCapabilities, narrowMergedAccess } from '../../src/turn/merged-principal.js';
import type { AgentCapabilities } from '../../src/plugin-runtime/capability-ingress.js';
import type { TurnAccessContext } from '../../src/turn/turn-ingress.js';

function access(subjectId: string, roles: readonly string[], unattended = false): TurnAccessContext {
  return Object.freeze({
    origin: Object.freeze({
      kind: 'im' as const,
      conversation: { id: '42', kind: 'group' } as never,
      platform: 'qq',
      endpoint: 'bot',
      scope: 'group' as const,
      sceneId: '42',
      messageId: `m-${subjectId}`,
    }),
    principal: Object.freeze({ subjectId, displayName: subjectId.toUpperCase(), roles: Object.freeze([...roles]) }),
    policy: Object.freeze({ permissions: Object.freeze([...roles]), unattended }),
  }) as TurnAccessContext;
}

function capabilities(tools: readonly string[], skills: readonly string[] = [], agents: readonly string[] = []): AgentCapabilities {
  return Object.freeze({
    generation: 1,
    owner: 'root' as never,
    tools: tools.map((name) => ({ name, execute: async () => name })) as never,
    skills: skills.map((qualifiedName) => ({ qualifiedName })) as never,
    agents: agents.map((qualifiedName) => ({ qualifiedName })) as never,
    mcp: Object.freeze([{ qualifiedName: 'mcp/a' }]) as never,
    promptSections: Object.freeze([{ name: 'section' }]) as never,
  });
}

describe('narrowMergedAccess (ADR 0038 §2)', () => {
  it('keeps the carrier as subject and origin but only the roles every member holds', () => {
    const carrier = access('alice', ['admin', 'user']);
    const merged = narrowMergedAccess(carrier, [carrier, access('bob', ['user']), access('carol', ['user', 'vip'])]);
    expect(merged.principal.subjectId).toBe('alice');
    expect(merged.origin).toBe(carrier.origin);
    expect(merged.principal.roles).toEqual(['user']);
    expect(merged.policy.permissions).toEqual(['user']);
  });

  it('never widens: a moderator member does not lend roles to a plain carrier', () => {
    const carrier = access('alice', ['user']);
    const merged = narrowMergedAccess(carrier, [carrier, access('mod', ['admin', 'trusted', 'user'])]);
    expect(merged.principal.roles).toEqual(['user']);
    expect(merged.policy.permissions).toEqual(['user']);
  });

  it('still narrows when the carrier itself is not among the members', () => {
    const carrier = access('alice', ['admin', 'user']);
    const merged = narrowMergedAccess(carrier, [access('bob', ['user'])]);
    expect(merged.principal.roles).toEqual(['user']);
  });

  it('is unattended when any member is', () => {
    const carrier = access('alice', ['user']);
    expect(narrowMergedAccess(carrier, [carrier, access('bob', ['user'], true)]).policy.unattended).toBe(true);
  });

  it('returns the carrier unchanged for a single-member turn', () => {
    const carrier = access('alice', ['admin']);
    expect(narrowMergedAccess(carrier, [carrier])).toBe(carrier);
  });
});

describe('intersectCapabilities (ADR 0038 §2)', () => {
  it('keeps only tools, skills and agents every member could see, bound from the carrier', () => {
    const carrier = capabilities(['search', 'remove_member', 'weather'], ['ops', 'chat'], ['helper', 'moderator']);
    const merged = intersectCapabilities(carrier, [
      capabilities(['search', 'weather'], ['chat'], ['helper']),
      capabilities(['search', 'remove_member', 'weather'], ['ops', 'chat'], ['helper']),
    ]);
    expect(merged.tools.map((tool) => tool.name)).toEqual(['search', 'weather']);
    expect(merged.tools[0]).toBe(carrier.tools[0]);
    expect(merged.skills.map((skill) => skill.qualifiedName)).toEqual(['chat']);
    expect(merged.agents.map((agent) => agent.qualifiedName)).toEqual(['helper']);
    expect(merged.mcp).toBe(carrier.mcp);
    expect(merged.promptSections).toBe(carrier.promptSections);
  });

  it('never adds a capability the carrier does not have (merge only narrows)', () => {
    const carrier = capabilities(['search']);
    const merged = intersectCapabilities(carrier, [capabilities(['search', 'remove_member', 'ban_member'])]);
    expect(merged.tools.map((tool) => tool.name)).toEqual(['search']);
  });

  it('returns the carrier unchanged when no other member is given', () => {
    const carrier = capabilities(['search']);
    expect(intersectCapabilities(carrier, [])).toBe(carrier);
    expect(intersectCapabilities(carrier, [carrier])).toBe(carrier);
  });
});
