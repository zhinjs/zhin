import { executionBundle } from '../helpers/execution-bundle.js';
import { describe, expect, it, vi } from 'vitest';
import {
  createUserMessage,
  type AgentMessage,
  type AgentTool,
  type Context,
} from '@zhin.js/ai';
import {
  wireMockLlmApi,
  assistantTextReply,
  assistantToolCallReply,
} from '../helpers/mock-llm-api.js';
import {
  DatabaseTurnCheckpointStorage,
  TurnCheckpointStore,
  extractCompletedToolRoundMessages,
  isCheckpointResumePrompt,
} from '../../src/turn/turn-checkpoint-store.js';

vi.mock('../../src/prompt/assembly.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/prompt/assembly.js')>(),
  buildAgentPathSystemPromptParts: async () => ({ stable: 'system', scene: '' }),
  buildChatPathSystemPromptParts: () => ({ stable: 'system', scene: '' }),
  describeAgentPathPromptSections: async () => [],
}));

const { runAgentLoopTextTurnRun, collectAgentLoopTurnRun } = await import('../../src/core/agent-core-run.js');

function makeTool(name: string, execute: (args: Record<string, unknown>) => unknown = () => `ok:${name}`): AgentTool {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    execute: async (args: Record<string, unknown>) => execute(args),
  } as unknown as AgentTool;
}

describe('TurnCheckpointStore & step-level checkpoint resume', () => {
  it('extracts only completed (assistant[toolCall] -> toolResult[]) rounds', () => {
    const userMsg = createUserMessage('查询天气并生成周报');
    const assistantRound1 = assistantToolCallReply([
      { id: 'call_1', name: 'get_weather', arguments: { city: 'Beijing' } },
      { id: 'call_2', name: 'get_calendar', arguments: {} },
    ]);
    const result1: AgentMessage = {
      role: 'toolResult',
      toolCallId: 'call_1',
      toolName: 'get_weather',
      content: [{ type: 'text', text: 'Sunny 25C' }],
      isError: false,
      timestamp: Date.now(),
    };
    const result2: AgentMessage = {
      role: 'toolResult',
      toolCallId: 'call_2',
      toolName: 'get_calendar',
      content: [{ type: 'text', text: '3 meetings' }],
      isError: false,
      timestamp: Date.now(),
    };
    const assistantRound2Incomplete = assistantToolCallReply([
      { id: 'call_3', name: 'write_report', arguments: {} },
    ]);

    // No tool results yet -> empty
    expect(extractCompletedToolRoundMessages([userMsg, assistantRound1])).toEqual([]);
    // Only 1 of 2 tool calls resolved -> empty
    expect(extractCompletedToolRoundMessages([userMsg, assistantRound1, result1])).toEqual([]);
    // Both tool calls resolved -> full round 1 returned
    expect(extractCompletedToolRoundMessages([userMsg, assistantRound1, result1, result2])).toEqual([
      userMsg,
      assistantRound1,
      result1,
      result2,
    ]);
    // Round 2 incomplete after Round 1 complete -> truncates cleanly at Round 1 end
    expect(
      extractCompletedToolRoundMessages([
        userMsg,
        assistantRound1,
        result1,
        result2,
        assistantRound2Incomplete,
      ]),
    ).toEqual([userMsg, assistantRound1, result1, result2]);
  });

  it('matches exact retry prompts and explicit continuation commands', () => {
    expect(isCheckpointResumePrompt('帮我查天气并写周报', '帮我查天气并写周报')).toEqual({
      resume: true,
      isExplicitContinue: false,
    });
    expect(isCheckpointResumePrompt('  帮我查天气  并写周报 ', '帮我查天气 并写周报')).toEqual({
      resume: true,
      isExplicitContinue: false,
    });
    expect(isCheckpointResumePrompt('继续', '帮我查天气并写周报')).toEqual({
      resume: true,
      isExplicitContinue: true,
    });
    expect(isCheckpointResumePrompt('continue', '帮我查天气并写周报')).toEqual({
      resume: true,
      isExplicitContinue: true,
    });
    expect(isCheckpointResumePrompt('今天吃什么', '帮我查天气并写周报')).toEqual({
      resume: false,
      isExplicitContinue: false,
    });
  });

  it('persists and prunes checkpoints via DatabaseTurnCheckpointStorage', async () => {
    const rows: Array<Record<string, unknown>> = [];
    const mockModel = {
      select: () => ({
        where: async (cond: Record<string, unknown>) =>
          rows.filter((r) => r.session_id === cond.session_id),
      }),
      create: async (row: Record<string, unknown>) => {
        rows.push({ ...row });
      },
      delete: () => ({
        where: async (cond: Record<string, unknown>) => {
          if (typeof cond.session_id === 'string') {
            for (let i = rows.length - 1; i >= 0; i -= 1) {
              if (rows[i]?.session_id === cond.session_id) rows.splice(i, 1);
            }
          } else if (cond.updated_at && typeof (cond.updated_at as { $lt?: number }).$lt === 'number') {
            const cutoff = (cond.updated_at as { $lt: number }).$lt;
            for (let i = rows.length - 1; i >= 0; i -= 1) {
              if (Number(rows[i]?.updated_at ?? 0) < cutoff) rows.splice(i, 1);
            }
          }
        },
      }),
    };
    const dbHost = {
      models: new Map([['agent_turn_checkpoints', mockModel]]),
    };

    let now = 1_000_000;
    const store1 = new TurnCheckpointStore({ ttlMs: 60_000, now: () => now });
    store1.activateDatabase(new DatabaseTurnCheckpointStorage(dbHost as never));

    const sampleMessages: AgentMessage[] = [
      createUserMessage('run pipeline'),
      assistantToolCallReply([{ id: 'tc_1', name: 'step_one', arguments: {} }]),
      {
        role: 'toolResult',
        toolCallId: 'tc_1',
        toolName: 'step_one',
        content: [{ type: 'text', text: 'step_one_done' }],
        isError: false,
        timestamp: now,
      },
    ];

    await store1.save({
      sessionId: 'sess-1',
      promptText: 'run pipeline',
      messages: sampleMessages,
      iterations: 1,
      updatedAt: now,
    });

    // Fresh store instance reads from DatabaseTurnCheckpointStorage
    const store2 = new TurnCheckpointStore({ ttlMs: 60_000, now: () => now });
    store2.activateDatabase(new DatabaseTurnCheckpointStorage(dbHost as never));

    const loaded = await store2.peek('sess-1');
    expect(loaded).toBeDefined();
    expect(loaded?.promptText).toBe('run pipeline');
    expect(loaded?.messages).toHaveLength(3);

    // Advance clock past TTL -> peek returns undefined and cleans up
    now += 120_000;
    expect(await store2.peek('sess-1')).toBeUndefined();
    expect(rows).toHaveLength(0);
  });

  it('resumes an aborted multi-step tool turn from the last completed toolResult without re-running completed tools', async () => {
    const abortController = new AbortController();
    const turnCheckpoints = new TurnCheckpointStore();
    const persistedHistory: AgentMessage[] = [];
    const executedTools: string[] = [];

    const tools = [
      makeTool('step_one', () => 'step_one_output'),
      makeTool('step_two', () => 'step_two_output'),
    ];

    let llmCallCount = 0;
    const llm = wireMockLlmApi({
      models: ['m'],
      responder: (context: Context) => {
        llmCallCount += 1;
        const hasStepOneResult = context.messages.some(
          (m) => m.role === 'toolResult' && (m as { toolName?: string }).toolName === 'step_one',
        );
        const hasStepTwoResult = context.messages.some(
          (m) => m.role === 'toolResult' && (m as { toolName?: string }).toolName === 'step_two',
        );

        if (!hasStepOneResult) {
          return assistantToolCallReply([{ id: 'c_step1', name: 'step_one', arguments: {} }]);
        }
        // Simulate mid-turn interruption on the first turn right after step_one's toolResult is committed
        if (llmCallCount === 2) {
          abortController.abort();
          throw new Error('aborted during iteration 2');
        }
        if (!hasStepTwoResult) {
          return assistantToolCallReply([{ id: 'c_step2', name: 'step_two', arguments: {} }]);
        }
        return assistantTextReply('All steps completed: step_one_output + step_two_output');
      },
    });

    const runTurn = async (rawContent: string, signal?: AbortSignal) => {
      const host = {
        contextRepository: {
          loadContext: async () => ({ messages: [...persistedHistory] }),
          appendMessages: async (_id: string, messages: AgentMessage[]) => {
            persistedHistory.push(...messages);
          },
        },
        turnCheckpoints,
        getTurnExecution: () =>
          executionBundle({
            model: {
              api: 'fixture',
              provider: llm.provider.name,
              input: ['text'],
              contextWindow: 0,
              maxTokens: 8192,
              ...llm.runtime.model(llm.provider.name, llm.provider.models?.[0]),
            },
            completion: llm.runtime,
          }),
        completion: llm.runtime,
        config: {
          outputSchema: false,
          maxIterations: 5,
          toolExecution: 'sequential',
          compaction: {},
          contextTokens: 100_000,
          toolBudget: { autoContinue: 'off', progressMaxUpdates: 0 },
        },
        compactionRuntime: { transformContext: async (messages: AgentMessage[]) => messages },
        getActiveTurnTracker: () => undefined,
        promptTraceConfig: {},
        phaseConfig: {},
      };
      const authority = {
        execute: async (target: AgentTool, args: Record<string, unknown>) => {
          executedTools.push(target.name);
          const output = await (target as unknown as { execute(a: unknown): Promise<unknown> }).execute(args);
          return { status: 'completed' as const, output, durationMs: 1 };
        },
      };
      const result = await collectAgentLoopTurnRun(
        runAgentLoopTextTurnRun({
          host: host as never,
          sessionId: 'sess-resume',
          rawContent,
          promptProfile: { kind: 'interactive' } as never,
          turnContext: {
            origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'private', sceneId: 'u' },
            principal: { subjectId: 'u', roles: ['user'] },
            session: { key: 'sess-resume' },
            policy: { permissions: [], unattended: false },
          } as never,
          allTools: tools,
          resolvedTools: tools,
          toolExecution: authority as never,
          personaEnhanced: '',
          modelId: 'm',
          modelCandidates: ['m'],
          toolLoading: 'direct',
          signal,
          conversationPersistence: 'session',
        } as never),
      );
      await result.projectConversation?.();
      return result;
    };

    // Turn 1: Executes step_one, then aborts during Iteration 2
    const turn1 = await runTurn('执行两步任务', abortController.signal);
    expect(turn1.reply).toBe('');
    expect(executedTools).toEqual(['step_one']);
    expect(persistedHistory).toHaveLength(0);

    // Verify checkpoint was saved with [user, assistant(step_one), toolResult(step_one)]
    const savedCheckpoint = await turnCheckpoints.peek('sess-resume');
    expect(savedCheckpoint).toBeDefined();
    expect(savedCheckpoint?.messages).toHaveLength(3);

    // Turn 2: User sends '继续' (or retries the same prompt) -> resumes from step_one's toolResult!
    executedTools.length = 0;
    const turn2 = await runTurn('继续');
    expect(turn2.reply).toContain('All steps completed');
    // Crucial: step_one was NOT re-executed in Turn 2! Only step_two ran.
    expect(executedTools).toEqual(['step_two']);
    // Checkpoint is cleared after normal turn completion
    expect(await turnCheckpoints.peek('sess-resume')).toBeUndefined();
    // Persisted conversation history now contains both step_one and step_two rounds
    expect(persistedHistory.some((m) => m.role === 'toolResult' && (m as { toolName?: string }).toolName === 'step_one')).toBe(true);
    expect(persistedHistory.some((m) => m.role === 'toolResult' && (m as { toolName?: string }).toolName === 'step_two')).toBe(true);
  });
});
