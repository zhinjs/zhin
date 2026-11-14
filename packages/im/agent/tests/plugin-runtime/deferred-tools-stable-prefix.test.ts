import { describe, expect, it, vi } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { touchToolInSnapshot, type DeferredToolSessionSnapshot } from '@zhin.js/ai';
import type { AgentCapabilities, ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import {
  createDeferredCapabilityPlan,
  restoreProjectedOutEntries,
} from '../../src/plugin-runtime/deferred-capability-plan.js';

// #1250 deferred-tools-break-prefix: adjacent requests of one session keep the tools prefix.
describe('deferred tools keep the request tools prefix across turns', () => {
  const owner = rootPluginId();
  const names = ['alpha', 'beta', 'schedule_add', 'schedule_list', 'schedule_remove', 'weather'];
  const capabilities: AgentCapabilities = Object.freeze({
    generation: 1,
    owner,
    tools: Object.freeze(names.map(name => tool(name))),
    skills: Object.freeze([]),
    agents: Object.freeze([]),
    mcp: Object.freeze([]),
    promptSections: Object.freeze([]),
  });

  function sessionStore(initial: DeferredToolSessionSnapshot = { loadedTools: {}, loadedSkills: [] }) {
    let stored = initial;
    return {
      get: () => stored,
      plan: (ceiling?: (name: string) => boolean, maxLoadedPerSession = 12) => createDeferredCapabilityPlan({
        capabilities,
        sessionSnapshot: stored,
        config: { deferredTools: { alwaysLoadedTools: ['weather', 'alpha'], alwaysLoadedMode: 'replace', maxLoadedPerSession } },
        persistSnapshot: async (next) => { stored = next; },
        ...(ceiling ? { ceiling: { project: (given: AgentCapabilities) => ({ tools: given.tools.filter(item => ceiling(item.name)), skills: given.skills }) } } : {}),
      }),
    };
  }
  const toolNames = (plan: ReturnType<ReturnType<typeof sessionStore>['plan']>) => plan.resolvedTools.map(item => item.name);

  it('puts resident tools first in a fixed order and appends loaded tools', async () => {
    const session = sessionStore();
    const first = session.plan();
    expect(toolNames(first).slice(0, 2)).toEqual(['alpha', 'weather']);
    await first.controller.load('schedule_list');
    await first.controller.load('schedule_add');

    const second = session.plan();
    const secondTools = toolNames(second);
    expect(secondTools).toEqual(['alpha', 'weather', 'schedule_list', 'schedule_add']);
    await second.controller.load('beta');
    // Re-using an already loaded tool never reorders the list.
    await second.controller.load('schedule_list');

    const third = toolNames(session.plan());
    expect(third.slice(0, secondTools.length)).toEqual(secondTools);
    expect(third).toEqual([...secondTools, 'beta']);
    // And the following turn sends exactly the same list.
    expect(toolNames(session.plan())).toEqual(third);
  });

  it('keeps tools a narrower turn could not see, so the next turn has the same prefix', async () => {
    const session = sessionStore();
    const wide = session.plan();
    await wide.controller.load('schedule_add');
    await wide.controller.load('beta');
    const before = toolNames(session.plan());

    // A turn whose policy hides schedule_* loads another tool and persists its snapshot.
    const narrow = session.plan(name => !name.startsWith('schedule_'));
    expect(toolNames(narrow)).not.toContain('schedule_add');
    await narrow.controller.load('schedule_list').then(loaded => expect(loaded).toBe(false));
    await narrow.controller.load('beta');

    const after = toolNames(session.plan());
    expect(after).toEqual(before);
  });

  it('evicts the earliest loaded tool past the cap and logs it', async () => {
    const session = sessionStore();
    const plan = session.plan(undefined, 2);
    await plan.controller.load('schedule_add');
    await plan.controller.load('schedule_list');
    await plan.controller.load('schedule_add');
    await plan.controller.load('beta');
    expect(toolNames(session.plan(undefined, 2))).toEqual(['alpha', 'weather', 'schedule_list', 'beta']);
  });
});

describe('deferred tool snapshot eviction', () => {
  it('evicts by first-load order and reports the evicted names', () => {
    const onEvict = vi.fn();
    let snapshot: DeferredToolSessionSnapshot = { loadedTools: {}, loadedSkills: [] };
    snapshot = touchToolInSnapshot(snapshot, 'a', 2, onEvict);
    snapshot = touchToolInSnapshot(snapshot, 'b', 2, onEvict);
    snapshot = touchToolInSnapshot(snapshot, 'a', 2, onEvict);
    expect(onEvict).not.toHaveBeenCalled();
    snapshot = touchToolInSnapshot(snapshot, 'c', 2, onEvict);
    expect(onEvict).toHaveBeenCalledWith(['a']);
    expect(snapshot.loadedOrder).toEqual(['b', 'c']);
    expect(Object.keys(snapshot.loadedTools).sort()).toEqual(['b', 'c']);
  });

  it('restores hidden entries in their first-load position', () => {
    const stored: DeferredToolSessionSnapshot = {
      loadedTools: { a: 1, b: 2, c: 3 },
      loadedOrder: ['a', 'b', 'c'],
      loadedSkills: ['s1'],
    };
    const projected: DeferredToolSessionSnapshot = { loadedTools: { a: 1, c: 3 }, loadedOrder: ['a', 'c'], loadedSkills: [] };
    const next: DeferredToolSessionSnapshot = { loadedTools: { a: 1, c: 3, d: 4 }, loadedOrder: ['a', 'c', 'd'], loadedSkills: ['s2'] };
    const merged = restoreProjectedOutEntries(stored, projected, next);
    expect(merged.loadedOrder).toEqual(['a', 'b', 'c', 'd']);
    expect(merged.loadedSkills).toEqual(['s1', 's2']);
  });
});

function tool(name: string): ToolCapability {
  return Object.freeze({
    owner: rootPluginId(),
    name,
    qualifiedName: name,
    description: name,
    requiresApproval: 'never',
    source: `/tools/${name}.ts`,
    execute: async <TInput = unknown, TResult = unknown>(input: TInput) => input as TResult,
  });
}
