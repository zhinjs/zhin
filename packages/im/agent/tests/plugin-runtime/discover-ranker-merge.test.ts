import { describe, expect, it, vi } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { ToolInvocationContext } from '@zhin.js/tool';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';

const ranking = vi.hoisted(() => ({ selectedNames: [] as string[] }));
vi.mock('../../src/decision/rank.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/decision/rank.js')>()),
  // An active ranker that abstains (or picks something else): applied, possibly empty.
  rankDecisionCandidates: vi.fn(async () => ({
    applied: true,
    selectedNames: [...ranking.selectedNames],
    outcome: ranking.selectedNames.length ? 'selected' : 'abstained',
  })),
}));

const { createDeferredCapabilityPlan, mergeDiscoverRows } = await import('../../src/plugin-runtime/deferred-capability-plan.js');

const owner = rootPluginId();
function tool(name: string, description: string): ToolCapability {
  return Object.freeze({
    owner, name, qualifiedName: name, description, requiresApproval: 'never',
    source: `/tools/${name}.ts`,
    execute: async <TInput = unknown, TResult = unknown>(input: TInput) => input as TResult,
  });
}
const invocation: ToolInvocationContext = Object.freeze({
  signal: new AbortController().signal, traceId: 't', turnId: 'turn', sessionKey: 'session',
  origin: { kind: 'internal', source: 'test' }, principal: { subjectId: 'user', roles: ['user'] },
  policy: { permissions: ['user'], unattended: false, network: { enabled: false } },
});

function discover(query: string): Promise<unknown> {
  const plan = createDeferredCapabilityPlan({
    capabilities: Object.freeze({
      generation: 1, owner,
      tools: Object.freeze([tool('zhin_js-music_music-search', 'Search songs on music platforms (音乐搜索)'), tool('weather', 'Weather forecast')]),
      skills: Object.freeze([]), agents: Object.freeze([]), mcp: Object.freeze([]), promptSections: Object.freeze([]),
    }),
    sessionSnapshot: { loadedTools: {}, loadedSkills: [] },
    config: { deferredTools: {} },
    persistSnapshot: async () => undefined,
    decision: { config: { tools: { mode: 'on' } } } as never,
  });
  const meta = plan.capabilities.find(entry => entry.name === 'discover')!;
  return meta.execute({ query }, invocation);
}

describe('discover with an applied ranker (#1250)', () => {
  it('keeps keyword hits when the ranker selects nothing', async () => {
    ranking.selectedNames = [];
    for (const query of ['music', '音乐']) {
      const result = String(await discover(query));
      expect(result).not.toBe('No matches.');
      expect(result).toContain('zhin_js-music_music-search');
    }
  });

  it('lists ranker picks first, then keyword hits, each once', async () => {
    ranking.selectedNames = ['weather'];
    const result = String(await discover('music'));
    expect(result.indexOf('[tool] weather')).toBeLessThan(result.indexOf('[tool] zhin_js-music_music-search'));
    expect(mergeDiscoverRows([{ name: 'a' }, { name: 'b' }], [{ name: 'b' }, { name: 'c' }]).map(row => row.name))
      .toEqual(['a', 'b', 'c']);
  });
});
