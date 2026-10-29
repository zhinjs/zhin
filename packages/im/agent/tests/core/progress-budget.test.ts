import { describe, expect, it, vi } from 'vitest';
import { createUserMessage, type AgentMessage, type AgentTool, type Context } from '@zhin.js/ai';
import { wireMockLlmApi, assistantTextReply, assistantToolCallReply } from '../helpers/mock-llm-api.js';

vi.mock('../../src/prompt/assembly.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/prompt/assembly.js')>(),
  buildAgentPathSystemPromptParts: async () => ({ stable: 'system', scene: '' }),
  buildChatPathSystemPromptParts: () => ({ stable: 'system', scene: '' }),
  describeAgentPathPromptSections: async () => [],
}));

const { runAgentLoopTextTurnRun, collectAgentLoopTurnRun } = await import('../../src/core/agent-core-run.js');
const { ExplorationBudget } = await import('../../src/core/exploration-budget.js');
const {
  TurnProgressReporter,
  friendlyProgressText,
  fallbackProgressText,
  PROGRESS_UPDATE_PREFIX,
} = await import('../../src/core/progress-reporter.js');
const { autoContinueAllowed, progressUpdatesAllowed, resolveToolBudget } = await import('../../src/core/turn-progress.js');

type Step = { tool: string; args?: Record<string, unknown>; text?: string } | { reply: string };

function tool(name: string, execute: (args: Record<string, unknown>) => unknown = () => `ok:${name}`): AgentTool {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    execute: async (args: Record<string, unknown>) => execute(args),
  } as unknown as AgentTool;
}

const lastUserText = (context: Context) => {
  const last = [...context.messages].reverse().find((message) => message.role === 'user') as AgentMessage | undefined;
  const content = (last as { content?: unknown })?.content;
  return typeof content === 'string'
    ? content
    : Array.isArray(content) ? content.map((block: { text?: string }) => block.text ?? '').join('') : '';
};

function scripted(next: (index: number, context: Context) => Step, extra: {
  summary?: string;
  progress?: string;
} = {}) {
  let index = 0;
  return wireMockLlmApi({
    models: ['m'],
    responder: (context) => {
      const instruction = lastUserText(context);
      if (!context.tools?.length && instruction.includes('progress update')) {
        return assistantTextReply(extra.progress ?? '已经完成了一部分修改，接下来继续处理剩下的文件。');
      }
      if (!context.tools?.length && instruction.includes('tool-call steps')) {
        return assistantTextReply(extra.summary ?? '已完成部分工作，剩余步骤待继续。');
      }
      const step = next(index++, context);
      if ('reply' in step) return assistantTextReply(step.reply);
      return assistantToolCallReply([{ id: `c${index}`, name: step.tool, arguments: step.args ?? {} }], step.text);
    },
  });
}

async function run(options: {
  llm: ReturnType<typeof wireMockLlmApi>;
  rawContent?: string;
  history?: AgentMessage[];
  tools: AgentTool[];
  maxIterations?: number;
  toolBudget?: Record<string, unknown>;
  turn?: Record<string, unknown>;
  progressSink?: (text: string) => Promise<void>;
  autoContinuation?: boolean;
  maxTotalIterations?: number;
}) {
  const executed: string[] = [];
  const appended: AgentMessage[] = [];
  const host = {
    contextRepository: {
      loadContext: async () => ({ messages: options.history ?? [] }),
      appendMessages: async (_id: string, messages: AgentMessage[]) => { appended.push(...messages); },
    },
    getTurnProvider: () => ({ name: 'mock' }),
    llmRuntime: options.llm.runtime,
    config: {
      outputSchema: false, // this fixture exercises prose progress/recovery
      maxIterations: options.maxIterations ?? 3,
      toolExecution: 'sequential',
      compaction: {},
      contextTokens: 100_000,
      toolBudget: { autoContinue: 'off', progressMaxUpdates: 0, ...options.toolBudget },
    },
    compactionRuntime: { transformContext: async (messages: AgentMessage[]) => messages },
    getActiveTurnTracker: () => undefined,
    promptTraceConfig: {},
    phaseConfig: {},
  };
  const authority = {
    execute: async (target: AgentTool, args: Record<string, unknown>) => {
      executed.push(target.name);
      try {
        const output = await (target as unknown as { execute(a: unknown): Promise<unknown> }).execute(args);
        return { status: 'completed' as const, output, durationMs: 1 };
      } catch (error) {
        return { status: 'failed' as const, error: String(error), retryable: false };
      }
    },
  };
  const result = await collectAgentLoopTurnRun(runAgentLoopTextTurnRun({
    host: host as never,
    sessionId: 's',
    rawContent: options.rawContent ?? 'do the task',
    promptProfile: { kind: 'interactive' } as never,
    turnContext: (options.turn ?? {
      origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'private', sceneId: 'u' },
      principal: { subjectId: 'u', roles: ['user'] },
      session: { key: 'k' },
      policy: { permissions: [], unattended: false },
    }) as never,
    allTools: options.tools,
    resolvedTools: options.tools,
    toolExecution: authority as never,
    personaEnhanced: '',
    modelId: 'm',
    modelCandidates: ['m'],
    toolLoading: 'direct',
    progressSink: options.progressSink,
    autoContinuation: options.autoContinuation,
    maxTotalIterations: options.maxTotalIterations,
  } as never));
  await result.projectConversation?.();
  return { result, executed, appended };
}

const writes = (until: number, reply = 'done') => (index: number): Step =>
  index < until ? { tool: 'write_file', args: { path: `f${index}`, content: 'x' } } : { reply };

describe('progress-aware tool budget', () => {
  it('extends the soft budget while the turn makes progress', async () => {
    const llm = scripted(writes(5));
    const { result } = await run({ llm, tools: [tool('write_file')], toolBudget: { extendBy: 3 } });
    expect(result.reply).toBe('done');
    expect(result.iterations).toBe(6);
  });

  it('does not extend when the model repeats identical calls', async () => {
    const llm = scripted(() => ({ tool: 'write_file', args: { path: 'same' } }));
    const { result } = await run({ llm, tools: [tool('write_file')], toolBudget: { extendBy: 3 } });
    expect(result.iterations).toBe(3);
    // H1 still turns the exhausted turn into a human summary.
    expect(result.reply).toBe('已完成部分工作，剩余步骤待继续。');
  });

  it('does not extend on a failure streak', async () => {
    let calls = 0;
    const flaky = tool('write_file', () => { calls += 1; if (calls > 1) throw new Error('disk full'); return 'ok'; });
    const llm = scripted((index) => ({ tool: 'write_file', args: { path: `f${index}` } }));
    const { result } = await run({ llm, tools: [flaky], toolBudget: { extendBy: 3, failureStreakLimit: 2 } });
    expect(result.iterations).toBe(3);
  });

  it('respects the hard cap even while progressing', async () => {
    const llm = scripted((index) => ({ tool: 'write_file', args: { path: `f${index}` } }));
    const { result } = await run({
      llm,
      tools: [tool('write_file')],
      maxIterations: 2,
      toolBudget: { extendBy: 2, maxTotalIterations: 5 },
    });
    expect(result.iterations).toBe(5);
    expect(result.reply).toBe('已完成部分工作，剩余步骤待继续。');
  });

  it('pure exploration is not progress', async () => {
    const llm = scripted((index) => ({ tool: 'read_file', args: { path: `f${index}` } }));
    const { result } = await run({ llm, tools: [tool('read_file')], toolBudget: { extendBy: 3 } });
    expect(result.iterations).toBe(3);
  });
});

describe('exploration budget resets on the progress signal', () => {
  it('resets only on progress, not on any non-exploration call', () => {
    const budget = new ExplorationBudget(3);
    budget.record('read_file');
    budget.record('grep');
    budget.record('web_fetch_unknown', false);
    expect(budget.record('glob')).toContain('3 read-only exploration calls');
    budget.record('write_file', true);
    budget.record('read_file');
    expect(budget.record('grep')).toBeUndefined();
  });
});

describe('automatic continuation', () => {
  it('continues a progressing turn within the continuation cap and keeps it in history', async () => {
    const llm = scripted((index) => ({ tool: 'write_file', args: { path: `f${index}` } }));
    const { result, appended, executed } = await run({
      llm,
      tools: [tool('write_file')],
      maxIterations: 2,
      toolBudget: { extendBy: 0, autoContinue: 'on', maxContinuations: 2 },
    });
    expect(result.iterations).toBe(6);
    const notices = appended.filter((message) => message.role === 'user'
      && JSON.stringify(message).includes('Automatic continuation'));
    expect(notices).toHaveLength(2);
    expect(result.reply).not.toContain('已自动续跑');
    // Every step ran through the same Turn authority: no new turn, no wider policy.
    expect(executed.every((name) => name === 'write_file')).toBe(true);
  });

  it('finishes normally after a continuation', async () => {
    const llm = scripted((index, context) =>
      lastUserText(context).includes('Automatic continuation') || index >= 3
        ? (index >= 3 ? { reply: '全部完成' } : { tool: 'write_file', args: { path: `f${index}` } })
        : { tool: 'write_file', args: { path: `f${index}` } });
    const { result } = await run({
      llm,
      tools: [tool('write_file')],
      maxIterations: 2,
      toolBudget: { extendBy: 0, autoContinue: 'on' },
    });
    expect(result.reply).toBe('全部完成');
  });

  it('tells only non-chat callers that the turn was continued', async () => {
    const llm = scripted((index, context) =>
      lastUserText(context).includes('Automatic continuation') || index >= 3
        ? (index >= 3 ? { reply: '全部完成' } : { tool: 'write_file', args: { path: `f${index}` } })
        : { tool: 'write_file', args: { path: `f${index}` } });
    const { result } = await run({
      llm,
      tools: [tool('write_file')],
      maxIterations: 2,
      toolBudget: { extendBy: 0, autoContinue: 'on' },
      turn: {
        origin: { kind: 'http', sessionId: 'h' },
        principal: { subjectId: 'u', roles: ['master'] },
        session: { key: 'k' },
        policy: { permissions: [], unattended: false },
      },
    });
    expect(result.reply).toBe('（任务步骤较多，已自动续跑 1 次）\n\n全部完成');
  });

  it('does not continue without progress, when disabled, or for sub-agents', async () => {
    const reads = () => scripted((index) => ({ tool: 'read_file', args: { path: `f${index}` } }));
    expect((await run({ llm: reads(), tools: [tool('read_file')], toolBudget: { extendBy: 0, autoContinue: 'on' } }))
      .result.iterations).toBe(3);
    const writesForever = () => scripted((index) => ({ tool: 'write_file', args: { path: `f${index}` } }));
    expect((await run({ llm: writesForever(), tools: [tool('write_file')], toolBudget: { extendBy: 0, autoContinue: 'off' } }))
      .result.iterations).toBe(3);
    expect((await run({
      llm: writesForever(),
      tools: [tool('write_file')],
      toolBudget: { extendBy: 0, autoContinue: 'on' },
      autoContinuation: false,
    })).result.iterations).toBe(3);
  });

  it('defaults to master private chats only', () => {
    const turn = (roles: string[], scope: string) => ({
      origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope, sceneId: 'x' },
      principal: { subjectId: 'x', roles },
      session: { key: 'k' },
    }) as never;
    expect(resolveToolBudget({}).autoContinue).toBe('master_dm');
    expect(autoContinueAllowed('master_dm', turn(['master'], 'private'))).toBe(true);
    expect(autoContinueAllowed('master_dm', turn(['master'], 'group'))).toBe(false);
    expect(autoContinueAllowed('master_dm', turn(['user'], 'private'))).toBe(false);
    expect(autoContinueAllowed('off', turn(['master'], 'private'))).toBe(false);
  });

  it('counts sub-agent completion as progress and continues the parent', async () => {
    const spawn = tool('spawn_task', (args) => `子任务「${String(args.label)}」已完成（同步等待）。\n\n改好了`);
    const llm = scripted((index, context) =>
      lastUserText(context).includes('Automatic continuation')
        ? { reply: '子任务都完成了' }
        : { tool: 'spawn_task', args: { task: `part ${index}`, label: `p${index}` } });
    const { result } = await run({
      llm,
      tools: [spawn],
      maxIterations: 2,
      toolBudget: { extendBy: 0, autoContinue: 'on' },
    });
    expect(result.reply).toBe('子任务都完成了');
  });
});

describe('progress updates to the user', () => {
  it('sends human summaries, never raw tool output, within the update cap', async () => {
    const sent: string[] = [];
    const llm = scripted((index) => index < 6
      ? { tool: 'write_file', args: { path: `f${index}` }, text: `写入 /Users/me/proj/src/f${index}.ts` }
      : { reply: 'done' });
    await run({
      llm,
      tools: [tool('write_file')],
      maxIterations: 10,
      toolBudget: { progressMinIntervalMs: 0, progressMaxUpdates: 2 },
      progressSink: async (text) => { sent.push(text); },
    });
    expect(sent).toHaveLength(2);
    for (const text of sent) {
      expect(text.startsWith(PROGRESS_UPDATE_PREFIX)).toBe(true);
      expect(text).not.toMatch(/\/Users|write_file|f\d\.ts/);
    }
    expect(sent[0]).toContain('已经完成了一部分修改');
  });

  it('falls back to a fixed friendly line when the summary is raw output', async () => {
    const sent: string[] = [];
    const llm = scripted(writes(3), { progress: '```json\n{"path":"/a/b"}\n```' });
    await run({
      llm,
      tools: [tool('write_file')],
      maxIterations: 10,
      toolBudget: { progressMinIntervalMs: 0, progressMaxUpdates: 1 },
      progressSink: async (text) => { sent.push(text); },
    });
    expect(sent).toEqual([`${PROGRESS_UPDATE_PREFIX}${fallbackProgressText(1)}`]);
  });

  it('throttles by interval and cap', async () => {
    let now = 0;
    const sent: string[] = [];
    const reporter = new TurnProgressReporter({
      sink: async (text) => { sent.push(text); },
      minIntervalMs: 45_000,
      maxUpdates: 2,
      summarize: async () => '已整理好数据，接下来生成报告。',
      now: () => now,
    });
    expect(await reporter.report('progress', { steps: 1 })).toBe(false);
    now = 20_000;
    expect(await reporter.report('progress', { steps: 2 })).toBe(false);
    expect(await reporter.report('extension', { steps: 2 })).toBe(true);
    expect(await reporter.report('continuation', { steps: 3 })).toBe(true);
    now = 999_000;
    expect(await reporter.report('continuation', { steps: 9 })).toBe(false);
    expect(sent).toHaveLength(2);
    expect(reporter.reported).toEqual(['已整理好数据，接下来生成报告。', '已整理好数据，接下来生成报告。']);
  });

  it('guards against raw output', () => {
    expect(friendlyProgressText('已修好登录问题，接下来补测试。')).toBe('已修好登录问题，接下来补测试。');
    expect(friendlyProgressText('read_file(path) returned')).toBeUndefined();
    expect(friendlyProgressText('{"ok":true}')).toBeUndefined();
    expect(friendlyProgressText('updated ./src/a/b.ts')).toBeUndefined();
    expect(friendlyProgressText('exit code 0, stdout: ...')).toBeUndefined();
  });

  it('is private-only by default; groups must opt in', () => {
    const turn = (scope: string) => ({ origin: { kind: 'im', scope }, principal: { roles: [] } }) as never;
    expect(resolveToolBudget({}).progressUpdates).toBe('private');
    expect(progressUpdatesAllowed('private', turn('private'))).toBe(true);
    expect(progressUpdatesAllowed('private', turn('group'))).toBe(false);
    expect(progressUpdatesAllowed('all', turn('group'))).toBe(true);
    expect(progressUpdatesAllowed('off', turn('private'))).toBe(false);
  });

  it('tells a continuation what was already reported', async () => {
    const sent: string[] = [];
    const seen: string[] = [];
    const llm = scripted((index, context) => {
      seen.push(lastUserText(context));
      return { tool: 'write_file', args: { path: `f${index}` } };
    });
    await run({
      llm,
      tools: [tool('write_file')],
      maxIterations: 2,
      toolBudget: { extendBy: 0, autoContinue: 'on', maxContinuations: 1, progressMinIntervalMs: 0, progressMaxUpdates: 5 },
      progressSink: async (text) => { sent.push(text); },
    });
    expect(sent.length).toBeGreaterThan(0);
    expect(seen.some((text) => text.includes('Progress updates already sent to the user'))).toBe(true);
  });
});

it.each([
  ['en', '用户用中文提问', '模型用中文回答'],
  ['zh-CN', 'The user writes in English', 'The model replies in English'],
  ['zh-CN', '请用英语回复。整理文件并总结。', 'The model follows the explicit English request'],
] as const)('uses %s only as a fallback on progress, continuation and exhausted requests: %s', async (locale, text, summary) => {
  const sent: string[] = [];
  const llm = scripted((index) => ({ tool: 'write_file', args: { path: `f${index}` } }), {
    summary, progress: '```json\n{"raw":"output"}\n```',
  });
  const { result } = await run({
    llm, rawContent: text, tools: [tool('write_file')], maxIterations: 2,
    toolBudget: { extendBy: 0, autoContinue: 'on', maxContinuations: 1, progressMinIntervalMs: 0, progressMaxUpdates: 1 },
    turn: {
      origin: { kind: 'im', platform: 'fixture', endpoint: 'bot', scope: 'private', sceneId: 'u' },
      principal: { subjectId: 'u', roles: ['user'] }, session: { key: 'k' },
      policy: { permissions: [], unattended: false }, input: { locale, text },
    },
    progressSink: async value => { sent.push(value); },
  });
  const progress = llm.calls.filter(call => lastUserText(call.context).includes('progress update'));
  const exhausted = llm.calls.filter(call => lastUserText(call.context).includes('tool-call steps'));
  expect(progress).toHaveLength(1);
  expect(exhausted).toHaveLength(2); // continuation checkpoint, then final recovery
  for (const call of [...progress, ...exhausted]) {
    const instruction = lastUserText(call.context);
    expect(instruction).toContain(`Reply language fallback: ${locale}.`);
    expect(instruction).toContain('applicable explicit reply-language request first');
    expect(instruction).toContain('actual request, not framework notices');
    expect(instruction).not.toMatch(/Reply to the user directly, in (?:English|Simplified Chinese)|user in (?:English|Simplified Chinese)/u);
    expect(JSON.stringify(call.context.messages)).toContain(text);
    expect(call.context.tools).toBeUndefined();
  }
  expect(llm.calls).toHaveLength(7); // no added translation or classification calls
  expect(sent).toEqual([`${PROGRESS_UPDATE_PREFIX}${fallbackProgressText(1, locale)}`]);
  expect(result.reply).toBe(summary);
  expect(result.iterations).toBe(4);
});


it('retains an applicable earlier language request in summary context', async () => {
  const earlier = 'For the rest of this task, please reply in English.';
  const history = [createUserMessage(earlier)];
  const llm = scripted(writes(2), { summary: 'Completed the first part. Shall I continue?' });
  const { result } = await run({ llm, history, rawContent: '继续处理', tools: [tool('write_file')], maxIterations: 1, toolBudget: { extendBy: 0 },
    turn: {
      origin: { kind: 'im', platform: 'fixture', endpoint: 'bot', scope: 'private', sceneId: 'u' },
      principal: { subjectId: 'u', roles: ['user'] }, session: { key: 'k' },
      policy: { permissions: [], unattended: false }, input: { locale: 'zh-CN', text: '继续处理' },
    },
  });
  expect(llm.calls).toHaveLength(2);
  const summary = llm.calls.find(call => lastUserText(call.context).includes('tool-call steps'))!;
  expect(JSON.stringify(summary.context.messages)).toContain(earlier);
  expect(lastUserText(summary.context)).toContain('applicable explicit reply-language request first');
  expect(lastUserText(summary.context)).toContain('Reply language fallback: zh-CN.');
  expect(result.reply).toBe('Completed the first part. Shall I continue?');
  expect(history).toHaveLength(1);
});
