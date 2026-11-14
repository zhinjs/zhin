import { executionBundle } from '../helpers/execution-bundle.js';
import { describe, expect, it, vi } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { AgentMessage } from '@zhin.js/ai';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { createDeferredCapabilityPlan } from '../../src/plugin-runtime/deferred-capability-plan.js';
import { wireMockLlmApi, assistantTextReply, assistantToolCallReply } from '../helpers/mock-llm-api.js';

vi.mock('../../src/prompt/assembly.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/prompt/assembly.js')>(),
  buildAgentPathSystemPromptParts: async () => ({ stable: 'system', scene: '' }),
  buildChatPathSystemPromptParts: () => ({ stable: 'system', scene: '' }),
  describeAgentPathPromptSections: async () => [],
}));
const { runAgentLoopTextTurnRun, collectAgentLoopTurnRun } = await import('../../src/core/agent-core-run.js');
const { unavailableLoadedTool } = await import('../../src/core/agent-core-ports.js');

const owner = rootPluginId();
const executed: string[] = [];
function tool(name: string, description: string): ToolCapability {
  return Object.freeze({ owner, name, qualifiedName: name, description,
    inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
    requiresApproval: 'never', source: `/tools/${name}.ts`,
    execute: async <TInput = unknown, TResult = unknown>(input: TInput) => { executed.push(name); return `ok ${JSON.stringify(input)}` as TResult; },
  } as ToolCapability);
}

async function run(responses: ReturnType<typeof assistantTextReply>[]) {
  executed.length = 0;
  const plan = createDeferredCapabilityPlan({
    capabilities: Object.freeze({ generation: 1, owner, tools: Object.freeze([tool('memory_search', 'Search saved memories'), tool('weather_lookup', 'Current weather by city'), tool('calendar_lookup', 'Upcoming calendar events')]),
      skills: Object.freeze([]), agents: Object.freeze([]), mcp: Object.freeze([]), promptSections: Object.freeze([]) }),
    sessionSnapshot: { loadedTools: {}, loadedSkills: [] }, config: { deferredTools: {} }, toolTier: 'chat',
    persistSnapshot: async () => undefined,
  });
  const declared: string[][] = [];
  const llm = wireMockLlmApi({ models: ['m'], responder: (context) => { declared.push((context.tools ?? []).map(entry => entry.name)); return responses.shift() ?? assistantTextReply('{"segments":[{"type":"text","data":{"text":"done"}}]}'); } });
  const host = {
    contextRepository: { loadContext: async () => ({ messages: [] }), appendMessages: async (_s: string, _m: AgentMessage[]) => undefined },
    getTurnExecution: () => executionBundle({ model: { api: 'fixture', provider: llm.provider.name, input: ['text'], contextWindow: 0, maxTokens: 8192, ...llm.runtime.model(llm.provider.name, 'm') }, completion: llm.runtime }),
    completion: llm.runtime,
    config: { maxIterations: 5, outputSchema: false, providerResilience: { emptyReplyRetries: 0 }, toolExecution: 'sequential', compaction: {}, contextTokens: 100_000,
      toolBudget: { autoContinue: 'off', progressMaxUpdates: 0, extendBy: 0 } },
    compactionRuntime: { transformContext: async (messages: AgentMessage[]) => messages },
    getActiveTurnTracker: () => undefined, promptTraceConfig: {}, phaseConfig: {},
  };
  const result = await collectAgentLoopTurnRun(runAgentLoopTextTurnRun({
    host: host as never, sessionId: 's', rawContent: '天气 北京', promptProfile: { kind: 'interactive' },
    turnContext: { input: { text: '天气 北京' }, origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'private', sceneId: 'u' },
      principal: { subjectId: '123', roles: ['user'] }, session: { key: 's' } },
    allTools: [...plan.allTools], resolvedTools: [...plan.resolvedTools],
    toolExecution: { execute: async (agentTool: { name: string }, args: unknown) => {
      const capability = plan.capabilities.find(entry => entry.name === agentTool.name)!;
      return { status: 'completed', output: await capability.execute(args, { signal: new AbortController().signal } as never), durationMs: 1 };
    } } as never,
    personaEnhanced: '', modelId: 'm', modelCandidates: ['m'], toolLoading: 'deferred',
    deferredController: plan.controller, toolCatalog: [...plan.catalog],
    conversationPersistence: 'none',
  }), () => undefined);
  return { result, calls: llm.calls, declared };
}

describe('load_tool makes the tool callable in the same turn (#1250)', () => {
  it('declares the loaded tool on the very next request and runs it without discover', async () => {
    const { calls, declared } = await run([
      assistantToolCallReply([{ id: 'l1', name: 'load_tool', arguments: { name: 'weather_lookup' } }]),
      assistantToolCallReply([{ id: 'w1', name: 'weather_lookup', arguments: { city: '北京' } }]),
    ]);
    const names = declared;
    expect(names[0]).not.toContain('weather_lookup');
    expect(names[1]).toContain('weather_lookup');
    expect(executed).toEqual(['weather_lookup']);
    expect(calls).toHaveLength(3);
  });

  it('declares a tool loaded during the tools-mutating re-completion on the next request', async () => {
    const { calls, declared } = await run([
      assistantToolCallReply([{ id: 'c1', name: 'load_tool', arguments: { name: 'calendar_lookup' } }]),
      assistantToolCallReply([{ id: 'l1', name: 'load_tool', arguments: { name: 'weather_lookup' } }]),
      assistantToolCallReply([{ id: 'w1', name: 'weather_lookup', arguments: { city: '北京' } }]),
    ]);
    const names = declared;
    expect(names[2]).toContain('weather_lookup');
    expect(executed).toEqual(['weather_lookup']);
  });

  it('turns a load_tool success for a tool this turn cannot declare into an explicit error', () => {
    const catalog = [{ name: 'weather_lookup' }];
    expect(unavailableLoadedTool('load_tool', { name: 'web_fetch' }, 'Loaded tool "web_fetch". Use its tool definition for arguments.', catalog))
      .toMatch(/^Tool "web_fetch" cannot be called in this turn/u);
    expect(unavailableLoadedTool('load_tool', { name: 'weather_lookup' }, 'Loaded tool "weather_lookup".', catalog)).toBeUndefined();
    expect(unavailableLoadedTool('load_tool', { name: 'nope' }, 'Tool "nope" not found in catalog.', catalog)).toBeUndefined();
    expect(unavailableLoadedTool('discover', { name: 'web_fetch' }, 'Loaded tool', catalog)).toBeUndefined();
    expect(unavailableLoadedTool('load_tool', { name: 'web_fetch' }, 'Loaded tool', undefined)).toBeUndefined();
  });
});
