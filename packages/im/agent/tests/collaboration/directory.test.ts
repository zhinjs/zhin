import { describe, expect, it } from 'vitest';
import type { AgentDescriptor } from '@zhin.js/agent-feature';
import { ALL } from '@zhin.js/harness';
import { createCollaborationDirectory } from '../../src/collaboration/directory.js';
import { COLLABORATION_TOOL_NAMES } from '../../src/collaboration/contracts.js';

const collab = Object.values(COLLABORATION_TOOL_NAMES);

function agent(name: string, extra: Partial<AgentDescriptor> = {}): AgentDescriptor {
  return {
    name, displayName: name.toUpperCase(), description: `${name} desc`, instructions: `${name} rules`,
    ...extra,
  } as AgentDescriptor;
}

const entry = { name: 'main', toolNames: ['read', 'write'] };
const catalogTools = ['read', 'write', 'shell', 'search'];

function build(agents: AgentDescriptor[]) {
  return createCollaborationDirectory({ entry, agents, catalogTools });
}

describe('createCollaborationDirectory', () => {
  it('intersects declared tools with the catalog and removes disallowed tools', () => {
    const dir = build([agent('coder', { toolNames: ['read', 'shell', 'ghost'], disallowedTools: ['shell'] })]);
    expect(dir.get('coder')!.ceiling.tools).toEqual({ kind: 'only', names: ['read'] });
  });

  it('defaults to the catalog minus disallowed tools when no tools are declared', () => {
    const dir = build([agent('coder', { disallowedTools: ['shell'] })]);
    expect(dir.get('coder')!.ceiling.tools).toEqual({ kind: 'only', names: ['read', 'search', 'write'] });
  });

  it('adds collaboration tools only when the agent has a known contact', () => {
    const dir = build([
      agent('a', { toolNames: ['read'], collaboration: { contacts: ['b'] } }),
      agent('b', { toolNames: ['read'] }),
      agent('c', { toolNames: ['read'], collaboration: { contacts: ['nobody'] } }),
    ]);
    expect(dir.get('a')!.ceiling.tools).toEqual({ kind: 'only', names: ['read', ...collab].sort() });
    expect(dir.get('b')!.ceiling.tools).toEqual({ kind: 'only', names: ['read'] });
    expect(dir.get('c')!.ceiling.tools).toEqual({ kind: 'only', names: ['read'] });
  });

  it('restricts contacts to names present in the directory', () => {
    const dir = build([
      agent('a', { collaboration: { contacts: ['b', 'ghost'] } }),
      agent('b'),
    ]);
    expect(dir.get('a')!.ceiling.contacts).toEqual({ kind: 'only', names: ['b'] });
    expect(dir.get('b')!.ceiling.contacts).toEqual({ kind: 'only', names: [] });
  });

  it('defaults acceptsFrom to ALL and honors an explicit list', () => {
    const dir = build([
      agent('a'),
      agent('b', { collaboration: { acceptsFrom: ['human', 'a'] } }),
    ]);
    expect(dir.get('a')!.ceiling.acceptsFrom).toBe(ALL);
    expect(dir.get('b')!.ceiling.acceptsFrom).toEqual({ kind: 'only', names: ['a', 'human'] });
  });

  it('sets trust, egress and copies metadata', () => {
    const dir = build([agent('a', { model: 'm1', maxIterations: 7 })]);
    const a = dir.get('a')!;
    expect(a.ceiling.maxTrust).toBe('master');
    expect(a.ceiling.egress).toEqual({ network: true, hosts: ALL });
    expect(a).toMatchObject({ description: 'a desc', instructions: 'a rules', model: 'm1', maxIterations: 7, displayName: 'A' });
  });

  it('gives the entry every other agent as a contact and collaboration tools', () => {
    const dir = build([agent('b'), agent('a')]);
    expect(dir.entry.ceiling.tools).toEqual({ kind: 'only', names: ['read', 'write', ...collab].sort() });
    expect(dir.entry.ceiling.contacts).toEqual({ kind: 'only', names: ['a', 'b'] });
    expect(dir.entry.ceiling.acceptsFrom).toEqual({ kind: 'only', names: ['a', 'b', 'human'] });
    expect(dir.entry.ceiling.maxTrust).toBe('master');
  });

  it('gives a solo entry no collaboration tools', () => {
    const dir = build([]);
    expect(dir.entry.ceiling.tools).toEqual({ kind: 'only', names: ['read', 'write'] });
    expect(dir.list()).toEqual([]);
  });

  it('lists agents sorted without the entry; get resolves entry too', () => {
    const dir = build([agent('z'), agent('a'), agent('main')]);
    expect(dir.list().map((item) => item.name)).toEqual(['a', 'z']);
    expect(dir.get('main')).toBe(dir.entry);
    expect(dir.get('missing')).toBeUndefined();
  });

  it('first duplicate wins', () => {
    const dir = build([agent('a', { description: 'first' }), agent('a', { description: 'second' })]);
    expect(dir.list()).toHaveLength(1);
    expect(dir.get('a')!.description).toBe('first');
  });

  it('carries the qualified name and marks a bare name another plugin also uses (#1250 purpose keys)', () => {
    const dir = build([
      agent('a', { qualifiedName: 'p1__a' }),
      agent('a', { qualifiedName: 'p2__a' }),
      agent('b', { qualifiedName: 'p1__b' }),
    ]);
    expect(dir.get('a')).toMatchObject({ qualifiedName: 'p1__a', bareNameShared: true });
    expect(dir.get('b')!.qualifiedName).toBe('p1__b');
    expect(dir.get('b')).not.toHaveProperty('bareNameShared');
  });

  it('freezes everything', () => {
    const dir = build([agent('a')]);
    expect(Object.isFrozen(dir)).toBe(true);
    expect(Object.isFrozen(dir.entry)).toBe(true);
    expect(Object.isFrozen(dir.list())).toBe(true);
    expect(Object.isFrozen(dir.get('a'))).toBe(true);
    expect(Object.isFrozen(dir.get('a')!.ceiling)).toBe(true);
  });

  it('propagates collaboration.budget onto CollaborationAgent.defaultBudget and AgentCeiling.defaultBudget', () => {
    const dir = build([
      agent('researcher', {
        collaboration: {
          contacts: ['b'],
          budget: { modelCalls: 5, tokens: 12_000, wallMs: 30_000, sideEffects: 2 },
        },
      }),
      agent('b'),
    ]);
    const researcher = dir.get('researcher')!;
    expect(researcher.defaultBudget).toEqual({ modelCalls: 5, tokens: 12_000, wallMs: 30_000, sideEffects: 2 });
    expect(researcher.ceiling.defaultBudget).toEqual({ modelCalls: 5, tokens: 12_000, wallMs: 30_000, sideEffects: 2 });
  });
});
