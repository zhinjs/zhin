import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentRunJournal, AgentStreamEventType } from '@zhin.js/ai/agent-stream';
import { createAgentStreamBus } from '../../src/event/agent-stream-bus.js';
import { ToolApprovalOnceStore } from '../../src/tool/tool-approval-once-store.js';
import {
  resolveToolApprovalRequired,
  runToolApprovalGate,
} from '../../src/tool/tool-approval-gate.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';
import { markdownToPlainText } from '@zhin.js/core';

describe('tool-approval-gate', () => {
  let onceStore: ToolApprovalOnceStore;

  beforeEach(() => {
    onceStore = new ToolApprovalOnceStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolveToolApprovalRequired respects always/never and custom fn', async () => {
    expect(await resolveToolApprovalRequired('never', { toolName: 't', args: {}, sessionId: 's' })).toBe(false);
    expect(await resolveToolApprovalRequired('always', { toolName: 't', args: {}, sessionId: 's' })).toBe(true);
    expect(await resolveToolApprovalRequired('once', { toolName: 't', args: {}, sessionId: 's' }, onceStore)).toBe(true);
    onceStore.add('s', 't');
    expect(await resolveToolApprovalRequired('once', { toolName: 't', args: {}, sessionId: 's' }, onceStore)).toBe(false);
    expect(await resolveToolApprovalRequired(async () => true, { toolName: 't', args: {}, sessionId: 's' })).toBe(true);
  });

  it('runToolApprovalGate publishes input events via bus and proceeds when approved', async () => {
    const events: unknown[] = [];
    const bus = createAgentStreamBus();
    bus.registerSink({
      name: 'test',
      handle: (event) => { events.push(event); },
    });
    const commMessage = mockCommMessage();
    const denied = await runToolApprovalGate({
      toolName: 'danger',
      args: { path: '/tmp' },
      sessionId: 'sess-1',
      commMessage,
      policy: 'always',
      bus,
      port: { requestApproval: async () => true },
      publishCtx: { sessionId: 'sess-1' },
      onceStore,
      signal: new AbortController().signal,
    });
    expect(denied).toBeNull();
    expect(events).toEqual([
      expect.objectContaining({
        type: AgentStreamEventType.INPUT_REQUESTED,
        data: expect.objectContaining({ toolName: 'danger', kind: 'approval' }),
      }),
      expect.objectContaining({
        type: AgentStreamEventType.INPUT_COMPLETED,
        data: expect.objectContaining({ toolName: 'danger', approved: true }),
      }),
    ]);
  });

  it('fails closed for on-risk when no ApprovalPort is available', async () => {
    const denied = await runToolApprovalGate({
      toolName: 'danger',
      args: {},
      sessionId: 'sess-1',
      commMessage: mockCommMessage(),
      policy: 'on-risk',
      signal: new AbortController().signal,
    });

    expect(denied).toBe('Error: approval required but ApprovalPort unavailable');
  });

  it('includes the concrete operation when asking for fresh human approval', async () => {
    const requestApproval = vi.fn(async () => false);
    await runToolApprovalGate({
      toolName: 'group_kick', args: { group_id: 100, user_id: 200, reason: 'confirmed reason' },
      sessionId: 's', commMessage: mockCommMessage(), policy: 'human',
      port: { requestApproval }, signal: new AbortController().signal,
    });
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({
      humanOnly: true, question: expect.stringContaining('confirmed reason'),
    }));
  });

  it('shows the tool name and arguments literally on the legacy approval card (#1250 b113)', async () => {
    const requestApproval = vi.fn(async () => false);
    const hostile = 'x`](https://evil.example)\n### 已批准 <b>ok</b> <@U123> ![p](https://evil.example/p.png)';
    await runToolApprovalGate({
      toolName: 'mcp__srv__[go](https://evil.example)', args: { note: hostile, api_key: 'sk-secret-value-1234567890' },
      sessionId: 's', commMessage: mockCommMessage(), policy: 'human',
      port: { requestApproval }, signal: new AbortController().signal,
    });
    const question = (requestApproval.mock.calls[0] as unknown as [{ question: string }])[0].question;
    const [first, args] = question.split('\n');
    // One inline code span per value: no link, image, heading, HTML or mention syntax can take effect.
    expect(first).toMatch(/^工具「`[^`]+`」需要确认后执行。是否继续？$/u);
    expect(args).toMatch(/^本次参数：`[^`]+`$/u);
    expect(question.split('\n')).toHaveLength(2);
    expect(question).not.toContain('](');
    expect(question).not.toContain('![');
    expect(question).not.toMatch(/<[A-Za-z@]/u);
    // Secrets are masked like on the other approval cards.
    expect(question).not.toContain('sk-secret-value-1234567890');
    // The plain-text fallback shows the text, without backticks.
    expect(markdownToPlainText(question)).toContain('### 已批准');
  });

  it.each(['always', 'on-risk', 'once'] as const)('shows the masked arguments under policy %s too, as the main approval card does (#1250 b113)', async policy => {
    const requestApproval = vi.fn(async () => false);
    await runToolApprovalGate({
      toolName: 'send_mail', args: { to: 'a@example.com', subject: '`hi` <b>x</b>', api_key: 'sk-secret-value-1234567890' },
      sessionId: 's', commMessage: mockCommMessage(), policy,
      port: { requestApproval }, signal: new AbortController().signal,
    });
    const question = (requestApproval.mock.calls[0] as unknown as [{ question: string }])[0].question;
    const lines = question.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^本次参数：`+[^`].*`+$/u);
    expect(question).toContain('a@example.com');
    expect(question).not.toContain('sk-secret-value-1234567890');
    expect(question).not.toMatch(/<[A-Za-z@]/u);
  });

  it('shows the command and target file instead of the whole arguments outside human mode (#1250 b113)', async () => {
    const requestApproval = vi.fn(async () => false);
    await runToolApprovalGate({
      toolName: 'bash', args: { command: 'FOO_TOKEN=abc123secretvalue ls', cwd: '/srv', timeout: 5 },
      sessionId: 's', commMessage: mockCommMessage(), policy: 'always',
      port: { requestApproval }, signal: new AbortController().signal,
    });
    const question = (requestApproval.mock.calls[0] as unknown as [{ question: string }])[0].question;
    expect(question).toContain('命令：');
    expect(question).toContain('工作目录：`/srv`');
    expect(question).not.toContain('本次参数');
    expect(question).not.toContain('abc123secretvalue');

    requestApproval.mockClear();
    await runToolApprovalGate({
      toolName: 'write_file', args: { path: 'notes/a.md', content: 'x' },
      sessionId: 's', commMessage: mockCommMessage(), policy: 'always',
      port: { requestApproval }, signal: new AbortController().signal,
    });
    const fileQuestion = (requestApproval.mock.calls[0] as unknown as [{ question: string }])[0].question;
    expect(fileQuestion).toContain('目标文件：`notes/a.md`');
    expect(fileQuestion).not.toContain('本次参数');
  });

  it('shows no argument line for a tool called without arguments outside human mode', async () => {
    const requestApproval = vi.fn(async () => false);
    await runToolApprovalGate({
      toolName: 'ping', args: {}, sessionId: 's', commMessage: mockCommMessage(), policy: 'always',
      port: { requestApproval }, signal: new AbortController().signal,
    });
    const question = (requestApproval.mock.calls[0] as unknown as [{ question: string }])[0].question;
    expect(question.split('\n')).toHaveLength(1);
  });

  it('records approved request and result in the ordered turn journal', async () => {
    const journal = new AgentRunJournal({ sessionId: 'sess-1', turnId: 'turn-1' });
    const events: unknown[] = [];
    const bus = createAgentStreamBus();
    bus.registerSink({ name: 'test', handle: (event) => { events.push(event); } });
    const denied = await runToolApprovalGate({
      toolName: 'danger',
      args: { path: '/tmp' },
      sessionId: 'sess-1',
      commMessage: mockCommMessage(),
      policy: 'on-risk',
      port: { requestApproval: async () => true },
      bus,
      journal,
      signal: new AbortController().signal,
    });

    expect(denied).toBeNull();
    expect(journal.replay()).toMatchObject([
      {
        type: AgentStreamEventType.INPUT_REQUESTED,
        run: { sessionId: 'sess-1', turnId: 'turn-1' },
        sequence: 1,
        data: { kind: 'approval', toolName: 'danger' },
      },
      {
        type: AgentStreamEventType.INPUT_COMPLETED,
        run: { sessionId: 'sess-1', turnId: 'turn-1' },
        sequence: 2,
        data: { kind: 'approval', toolName: 'danger', approved: true },
      },
    ]);
    expect(events).toMatchObject(journal.replay());
  });
});
