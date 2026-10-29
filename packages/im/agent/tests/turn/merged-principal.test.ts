import { describe, expect, it } from 'vitest';
import {
  intersectCapabilities,
  narrowMergedAccess,
  resolveOnBehalfOf,
  withMergeMembers,
} from '../../src/turn/merged-principal.js';
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

describe('withMergeMembers (ADR 0038 §2)', () => {
  it('records each sender with the Tools they see alone, merging a sender listed twice', () => {
    const carrier = access('alice', ['admin', 'user']);
    const merged = withMergeMembers(carrier, [carrier, access('bob', ['user']), access('alice', ['admin'])], [
      ['kick', 'weather'],
      ['weather'],
      ['kick'],
    ]);
    expect(merged.principal).toBe(carrier.principal);
    expect(merged.policy.permissions).toEqual(carrier.policy.permissions);
    expect(merged.policy.merge?.members).toEqual([
      { subjectId: 'alice', displayName: 'ALICE', tools: ['kick'] },
      { subjectId: 'bob', displayName: 'BOB', tools: ['weather'] },
    ]);
    expect(Object.isFrozen(merged.policy.merge?.members)).toBe(true);
  });
});

describe('resolveOnBehalfOf (ADR 0038 §2)', () => {
  const merge = {
    members: [
      { subjectId: 'alice', displayName: 'Alice', tools: ['kick', 'notice'] },
      { subjectId: 'bob', displayName: 'Bob', tools: ['notice'] },
      { subjectId: 'carol', displayName: 'Bob', tools: ['notice'] },
    ],
  };

  it('allows a call for a named sender who may make it', () => {
    expect(resolveOnBehalfOf(merge, 'kick', 'alice')).toMatchObject({ status: 'allowed', member: { subjectId: 'alice' }, fallback: false });
    expect(resolveOnBehalfOf(merge, 'kick', 'Alice')).toMatchObject({ status: 'allowed', member: { subjectId: 'alice' } });
  });

  it('denies a named sender who may not make it, even when another sender may', () => {
    expect(resolveOnBehalfOf(merge, 'kick', 'bob')).toMatchObject({ status: 'denied', fallback: false, subjectId: 'bob' });
  });

  it('falls back to the lowest sender for a missing, unknown or ambiguous reference', () => {
    expect(resolveOnBehalfOf(merge, 'kick', undefined)).toMatchObject({ status: 'denied', fallback: true, subjectId: 'bob' });
    expect(resolveOnBehalfOf(merge, 'kick', 'master')).toMatchObject({ status: 'denied', fallback: true });
    // Two senders display as "Bob": the name picks neither.
    expect(resolveOnBehalfOf(merge, 'notice', 'Bob')).toMatchObject({ status: 'allowed', fallback: true, member: { subjectId: 'alice' } });
    expect(resolveOnBehalfOf(merge, 'notice', 42)).toMatchObject({ status: 'allowed', fallback: true });
  });

  it('denies everything for an empty merge', () => {
    expect(resolveOnBehalfOf({ members: [] }, 'notice', undefined)).toMatchObject({ status: 'denied' });
  });
});
