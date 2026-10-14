/**
 * Cross-fix regressions for the IM harness hardening: each case exercises two
 * fixes together (deferred auto-load, shell policy, typed approvals, exhausted
 * turn summaries, exploration output hygiene).
 */
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_TOKEN_USAGE, type AgentMessage, type AssistantMessage, type Context, type Model } from '@zhin.js/ai';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { createMissingToolResolver } from '../../src/core/missing-tool-resolver.js';
import { withoutForbiddenShell } from '../../src/plugin-runtime/native-bash-tool.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { formatApprovalDenial, type ApprovalOutcomePort } from '../../src/session/approval-port.js';
import { summarizeExhaustedTurn } from '../../src/core/exhausted-turn-reply.js';
import { formatToolCallsForUser } from '../../src/core/tool-calls-user-format.js';

const noShellPolicy = { filesystem: { workspaceRoot: '/workspace', access: 'read-only' as const } };
const catalog = [{ name: 'read_file' }, { name: 'bash' }, { name: 'plugin_action' }];

describe('deferred auto-load × shell policy (H2 + H3)', () => {
  it('refuses a direct bash call without loading it into the session', async () => {
    const load = vi.fn(async () => true);
    const resolve = createMissingToolResolver({
      catalog: withoutForbiddenShell(noShellPolicy, catalog),
      load,
      rebuild: () => [{ name: 'bash' }, { name: 'read_file' }],
    })!;

    await expect(resolve('bash')).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
    await expect(resolve('read_file')).resolves.toEqual({ name: 'read_file' });
    expect(load).toHaveBeenCalledWith('read_file');
  });
});

describe('deferred auto-load × typed approvals (H2 + H4)', () => {
  it('gives an auto-loaded tool that needs approval the typed outcome, not Unknown tool', async () => {
    const execute = vi.fn(async () => 'done');
    const capability: ToolCapability = {
      owner: rootPluginId(),
      name: 'plugin_action',
      qualifiedName: 'plugin_action',
      description: 'needs approval',
      requiresApproval: 'once',
      source: '/tools/plugin-action.ts',
      execute,
    };
    const resolve = createMissingToolResolver({
      catalog,
      load: async () => true,
      rebuild: () => [capability],
    })!;
    const tool = await resolve('plugin_action');
    expect(tool?.name).toBe('plugin_action');

    const approval: ApprovalOutcomePort = {
      available: true,
      requestApproval: async () => false,
      requestApprovalOutcome: async () => ({ status: 'timed_out' }),
    };
    const runtime = new TurnToolRuntime(turnWith(approval), [tool!]);
    const outcome = await runtime.execute('plugin_action', {}, 'auto-loaded');

    expect(outcome).toEqual({
      status: 'denied',
      policy: 'approval',
      reason: formatApprovalDenial({ status: 'timed_out' }),
    });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('exhausted turn × typed approvals (H1 + H4)', () => {
  it('summarizes a turn that ran out of steps after an approval was denied', async () => {
    const denial = formatApprovalDenial({ status: 'denied', by: 'reviewer' });
    const complete = vi.fn(async (_model: Model, _context: Context) => reply('读取 package.json 被自动审核拒绝了，需要你确认后我再继续。'));
    const messages: AgentMessage[] = [{
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'read_file',
      content: [{ type: 'text', text: denial }],
      isError: true,
      timestamp: Date.now(),
    }];

    const result = await summarizeExhaustedTurn({
      transport: { complete, completeSimple: complete },
      model: { id: 'mock', api: 'ai-sdk', provider: 'mock' } as unknown as Model,
      systemPrompt: 'system',
      messages,
      maxIterations: 15,
    });

    expect(result.reply).toContain('审核拒绝');
    const context = complete.mock.calls[0]![1];
    expect(JSON.stringify(context.messages)).toContain('automatic approval reviewer');
    expect(context.tools ?? []).toHaveLength(0);
  });
});

describe('user-facing fallback × truncated exploration output (H1 + H5)', () => {
  it('hides truncated grep/glob bodies and their narrowing notices from the user', () => {
    const out = formatToolCallsForUser([
      { tool: 'grep', result: 'src/a.ts:1:needle\n[truncated at 50 matches; narrow the pattern, path, or include filter to see more]' },
      { tool: 'glob', result: 'Found 100 files:\na.ts\n[truncated at 100 files; narrow the pattern, path, or include filter to see more]' },
      { tool: 'read_file', result: 'File: /w/big.txt (2500 lines, showing 1-2000)\n[500 more lines; call read_file again with offset=2000 to continue]' },
    ]);
    expect(out).toContain('只做了资料查阅');
    expect(out).not.toMatch(/truncated|narrow the pattern|offset=2000|needle/);
  });
});

function reply(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'ai-sdk',
    provider: 'mock',
    model: 'mock',
    usage: { ...EMPTY_TOKEN_USAGE },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

function turnWith(approval: ApprovalOutcomePort) {
  return createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'http', sessionId: 'http-session' },
    principal: { subjectId: 'user', roles: ['user'] },
    input: { text: 'run' },
    session: { key: 'http:http-session' },
    policy: { permissions: ['user'], unattended: false },
    capabilities: { tools: ['plugin_action'], skills: [] },
    signal: new AbortController().signal,
    ports: { journal: { append: () => {} }, approval },
  });
}
