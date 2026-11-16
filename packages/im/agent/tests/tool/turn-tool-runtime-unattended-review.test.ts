/**
 * #1250 b33: approval requests of unattended turns (scheduled tasks) go to the automatic reviewer under
 * `execApprovalMode: auto`, fail closed, and never reach a person.
 */
import { describe, expect, it, vi } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { TurnEvent } from '../../src/event/turn-event.js';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { ApprovalReviewAgent, createAutoApprovalPort } from '../../src/session/approval-review-agent.js';
import type { ApprovalJudgmentPort } from '../../src/decision/approval-judgment.js';
import type { ApprovalPort } from '../../src/session/approval-port.js';
import { PROVENANCE_POLICY } from '../../src/security/provenance.js';

const notes = vi.hoisted(() => [] as unknown[]);
vi.mock('../../src/trace/turn-trace-registry.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/trace/turn-trace-registry.js')>();
  return { ...original, noteTurnTrace: (turnId: string | undefined, note: unknown) => { notes.push({ turnId, note }); } };
});

function reviewPort(judge: ApprovalJudgmentPort['judge']): ApprovalPort {
  return createAutoApprovalPort(new ApprovalReviewAgent({ judgment: { judge }, timeoutMs: 50 }));
}

function fixture(options: { unattendedReview?: ApprovalPort; unattended?: boolean; approval?: ApprovalPort } = {}) {
  const events: TurnEvent[] = [];
  const turn = createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn-b33' },
    origin: { kind: 'http', sessionId: 'schedule-like' },
    principal: { subjectId: 'owner-1', roles: ['owner'] },
    input: { text: 'weather' },
    session: { key: 'schedule:job-1' },
    policy: { permissions: [], unattended: options.unattended ?? true },
    capabilities: { tools: ['weather'], skills: [] },
    signal: new AbortController().signal,
    ports: {
      journal: { append: (event) => { events.push(event); } },
      ...(options.unattendedReview ? { unattendedReview: options.unattendedReview } : {}),
      ...(options.approval ? { approval: options.approval } : {}),
    },
  });
  return { turn, events };
}

function tool(execute: ToolCapability['execute'], overrides: Partial<ToolCapability> = {}): ToolCapability {
  return {
    owner: rootPluginId(),
    name: 'weather',
    qualifiedName: 'weather',
    description: 'Weather lookup',
    requiresApproval: 'on-risk',
    source: '/tools/weather.ts',
    execute,
    ...overrides,
  };
}

describe('TurnToolRuntime unattended review (#1250 b33)', () => {
  it('runs an on-risk tool in an unattended turn when the automatic reviewer approves, and traces the verdict', async () => {
    notes.length = 0;
    const execute = vi.fn(async () => 'sunny');
    const judge = vi.fn<ApprovalJudgmentPort['judge']>(async () => ({ decision: 'approve' as const }));
    const { turn } = fixture({ unattendedReview: reviewPort(judge) });
    await expect(new TurnToolRuntime(turn, [tool(execute)]).execute('weather', { city: '上海' }, 'call-1'))
      .resolves.toMatchObject({ status: 'completed', output: 'sunny' });
    expect(judge).toHaveBeenCalledOnce();
    expect(notes).toContainEqual({ turnId: 'turn-b33',
      note: { kind: 'unattended_review', tool: 'weather', policy: 'approval', outcome: 'approved' } });
  });

  it.each([
    ['rejects', async () => ({ decision: 'reject' as const }), 'rejected'],
    ['asks for a human', async () => ({ decision: 'ask' as const }), 'unavailable'],
    ['throws', async () => { throw new Error('model down'); }, 'rejected'],
    ['never answers', () => new Promise<never>(() => undefined), 'rejected'],
  ] as const)('denies the call when the reviewer %s (fail closed)', async (_label, judge, outcome) => {
    notes.length = 0;
    const execute = vi.fn(async () => 'sunny');
    const { turn, events } = fixture({ unattendedReview: reviewPort(judge as ApprovalJudgmentPort['judge']) });
    const result = await new TurnToolRuntime(turn, [tool(execute)]).execute('weather', {}, 'call-2');
    expect(result).toMatchObject({ status: 'denied', policy: 'approval' });
    expect((result as { reason: string }).reason).toContain('unattended turn');
    expect((result as { reason: string }).reason).not.toContain('ask them whether to approve');
    expect(execute).not.toHaveBeenCalled();
    expect(events.map(event => event.type)).toEqual(['tool_call', 'tool_denied']);
    expect(notes).toContainEqual({ turnId: 'turn-b33',
      note: { kind: 'unattended_review', tool: 'weather', policy: 'approval', outcome } });
  });

  it('keeps denying unattended approval requests outright when there is no reviewer (execApprovalMode ask / bypass)', async () => {
    const execute = vi.fn(async () => 'sunny');
    const { turn } = fixture();
    const result = await new TurnToolRuntime(turn, [tool(execute)]).execute('weather', {}, 'call-3');
    expect(result).toMatchObject({ status: 'denied', policy: 'approval' });
    expect((result as { reason: string }).reason).toContain('this is an unattended turn');
    expect(execute).not.toHaveBeenCalled();
  });

  it('never sends a fresh-human-approval tool to the reviewer', async () => {
    const execute = vi.fn(async () => 'kicked');
    const judge = vi.fn<ApprovalJudgmentPort['judge']>(async () => ({ decision: 'approve' as const }));
    const { turn } = fixture({ unattendedReview: reviewPort(judge) });
    const result = await new TurnToolRuntime(turn, [tool(execute, { requiresApproval: 'human' })])
      .execute('weather', {}, 'call-4');
    expect(result).toMatchObject({ status: 'denied' });
    expect(judge).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not let the reviewer stand in for the initiator in an intent confirmation (provenance gate)', async () => {
    const execute = vi.fn(async () => 'sent');
    const judge = vi.fn<ApprovalJudgmentPort['judge']>(async () => ({ decision: 'approve' as const }));
    const { turn } = fixture({ unattendedReview: reviewPort(judge) });
    const runtime = new TurnToolRuntime(turn, [tool(execute, { name: 'send_notice', qualifiedName: 'send_notice', requiresApproval: 'never' })]);
    runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
    await expect(runtime.execute('send_notice', { text: 'hi' }, 'call-5'))
      .resolves.toMatchObject({ status: 'denied', policy: PROVENANCE_POLICY });
    expect(judge).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown decision', async () => ({ decision: 'APPROVE' }), 'rejected'],
    ['no decision', async () => ({}), 'rejected'],
    ['null', async () => null, 'rejected'],
  ] as const)('denies the call when the reviewer returns %s (fail closed)', async (_label, judge, outcome) => {
    notes.length = 0;
    const execute = vi.fn(async () => 'sunny');
    const { turn } = fixture({ unattendedReview: reviewPort(judge as unknown as ApprovalJudgmentPort['judge']) });
    await expect(new TurnToolRuntime(turn, [tool(execute)]).execute('weather', {}, 'call-m'))
      .resolves.toMatchObject({ status: 'denied', policy: 'approval' });
    expect(execute).not.toHaveBeenCalled();
    expect(notes).toContainEqual({ turnId: 'turn-b33',
      note: { kind: 'unattended_review', tool: 'weather', policy: 'approval', outcome } });
  });

  it('cancels instead of running when the turn is aborted while the reviewer is deciding', async () => {
    const execute = vi.fn(async () => 'sunny');
    const controller = new AbortController();
    const judge = vi.fn<ApprovalJudgmentPort['judge']>(async () => {
      controller.abort(new Error('stop'));
      return { decision: 'approve' as const };
    });
    const turn = createTurnIngress({
      intent: { kind: 'new' },
      identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn-abort' },
      origin: { kind: 'http', sessionId: 'schedule-like' },
      principal: { subjectId: 'owner-1', roles: ['owner'] },
      input: { text: 'weather' },
      session: { key: 'schedule:job-1' },
      policy: { permissions: [], unattended: true },
      capabilities: { tools: ['weather'], skills: [] },
      signal: controller.signal,
      ports: { journal: { append: () => undefined }, unattendedReview: reviewPort(judge) },
    });
    const result = await new TurnToolRuntime(turn, [tool(execute)]).execute('weather', {}, 'call-abort');
    expect(result.status).not.toBe('completed');
    expect(execute).not.toHaveBeenCalled();
  });

  it('never lets the reviewer approve a high-risk action after external content, even with confirmHighRisk off', async () => {
    const execute = vi.fn(async () => 'sent');
    const judge = vi.fn<ApprovalJudgmentPort['judge']>(async () => ({ decision: 'approve' as const }));
    const { turn } = fixture({ unattendedReview: reviewPort(judge) });
    const runtime = new TurnToolRuntime(turn, [tool(execute, { name: 'send_notice', qualifiedName: 'send_notice' })],
      { injectionGuard: { confirmHighRisk: 'off' } });
    runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
    await expect(runtime.execute('send_notice', { text: 'hi' }, 'call-7'))
      .resolves.toMatchObject({ status: 'denied', policy: PROVENANCE_POLICY });
    expect(judge).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('still lets the reviewer settle a high-risk action of an unattended turn before any external content', async () => {
    const execute = vi.fn(async () => 'sent');
    const judge = vi.fn<ApprovalJudgmentPort['judge']>(async () => ({ decision: 'approve' as const }));
    const { turn } = fixture({ unattendedReview: reviewPort(judge) });
    const runtime = new TurnToolRuntime(turn, [tool(execute, { name: 'send_notice', qualifiedName: 'send_notice' })],
      { injectionGuard: { confirmHighRisk: 'off' } });
    await expect(runtime.execute('send_notice', { text: 'hi' }, 'call-8')).resolves.toMatchObject({ status: 'completed' });
    expect(judge).toHaveBeenCalledOnce();
  });

  it('ignores an unattended reviewer on an attended turn (it uses its own approval port)', async () => {
    const execute = vi.fn(async () => 'sunny');
    const judge = vi.fn<ApprovalJudgmentPort['judge']>(async () => ({ decision: 'approve' as const }));
    const requestApproval = vi.fn(async () => false);
    const { turn } = fixture({ unattended: false, unattendedReview: reviewPort(judge), approval: { requestApproval } });
    await expect(new TurnToolRuntime(turn, [tool(execute)]).execute('weather', {}, 'call-6'))
      .resolves.toMatchObject({ status: 'denied' });
    expect(requestApproval).toHaveBeenCalledOnce();
    expect(judge).not.toHaveBeenCalled();
  });
});
