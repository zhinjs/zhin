/**
 * #1250: approval denials tell an unattended turn apart from a conversation without an approval channel,
 * an initiator-only confirmation never stands in for an authority's approval, and every turn prompt is audited.
 */
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import type { ApprovalOutcome, ApprovalOutcomePort, ApprovalRequestInput } from '../../src/session/approval-port.js';
import type { DecisionEventInput } from '../../src/decision-events.js';

function fixture(options: { unattended?: boolean; approval?: ApprovalOutcomePort } = {}) {
  return createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'turn' },
    origin: { kind: 'http', sessionId: 'http-session' },
    principal: { subjectId: 'user', roles: ['user'] },
    input: { text: 'run' },
    session: { key: 'http:http-session' },
    policy: { permissions: ['user'], unattended: options.unattended ?? false },
    capabilities: { tools: ['schedule_add', 'danger'], skills: [] },
    signal: new AbortController().signal,
    ports: {
      journal: { append: () => undefined },
      ...(options.approval ? { approval: options.approval } : {}),
    },
  });
}

function tool(execute: ToolCapability['execute'], requiresApproval: ToolCapability['requiresApproval'], name = 'schedule_add'): ToolCapability {
  return {
    owner: rootPluginId(), name, qualifiedName: name, description: '创建定时任务', requiresApproval, source: '/tools/t.ts', execute,
  };
}

function port(answer: (input: ApprovalRequestInput) => ApprovalOutcome) {
  const requests: ApprovalRequestInput[] = [];
  const approval: ApprovalOutcomePort = {
    available: true,
    requestApproval: async () => false,
    requestApprovalOutcome: async (input) => { requests.push(input); return answer(input); },
  };
  return { approval, requests };
}

describe('provenance gate without anyone to ask', () => {
  it('says an unattended turn is unattended and points to the Console schedule page', async () => {
    const execute = vi.fn(async () => 'scheduled');
    const runtime = new TurnToolRuntime(fixture({ unattended: true }), [tool(execute, 'never')]);
    runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
    const outcome = await runtime.execute('schedule_add', { cron: '0 9 * * 1-5' }, 'u1');
    expect(outcome).toMatchObject({ status: 'denied', policy: 'external-content-confirmation' });
    const reason = (outcome as { reason: string }).reason;
    expect(reason).toContain('无人值守的回合无法确认');
    expect(reason).toContain('运维 → 定时任务');
    expect(reason).toContain('never tell the user to type a tool name');
    expect(execute).not.toHaveBeenCalled();
  });

  it('says a conversation without an approval channel is not unattended', async () => {
    const execute = vi.fn(async () => 'scheduled');
    const runtime = new TurnToolRuntime(fixture(), [tool(execute, 'never')]);
    runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
    const outcome = await runtime.execute('schedule_add', {}, 'c1');
    const reason = (outcome as { reason: string }).reason;
    expect(outcome).toMatchObject({ status: 'denied', policy: 'external-content-confirmation' });
    expect(reason).toContain('这不是无人值守的回合');
    expect(reason).not.toContain('无人值守的回合无法确认');
    expect(reason).toContain('运维 → 定时任务');
    expect(reason).toContain('"schedule_add" are not chat commands');
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('ordinary approval without anyone to ask', () => {
  it('distinguishes unattended from no channel', async () => {
    const unattended = await new TurnToolRuntime(fixture({ unattended: true }), [tool(vi.fn(), 'always', 'danger')])
      .execute('danger', {}, 'a');
    const noChannel = await new TurnToolRuntime(fixture(), [tool(vi.fn(), 'always', 'danger')]).execute('danger', {}, 'b');
    expect((unattended as { reason: string }).reason).toContain('this is an unattended turn');
    expect((noChannel as { reason: string }).reason).toContain('this conversation has no approval channel');
    expect((noChannel as { reason: string }).reason).toContain('not an unattended turn');
  });
});

describe('intent-only confirmation', () => {
  it('lets a tool that needs no approval run after the initiator confirms intent', async () => {
    const execute = vi.fn(async () => 'scheduled');
    const { approval, requests } = port(() => ({ status: 'approved', decision: 'approve-once', scope: 'intent' }));
    const runtime = new TurnToolRuntime(fixture({ approval }), [tool(execute, 'never')]);
    runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
    await expect(runtime.execute('schedule_add', {}, 'i1')).resolves.toMatchObject({ status: 'completed' });
    expect(requests.map(request => request.purpose)).toEqual(['intent']);
  });

  it('still requires the authority approval after an initiator-only confirmation', async () => {
    const execute = vi.fn(async () => 'scheduled');
    const { approval, requests } = port((input) => input.purpose === 'intent'
      ? { status: 'approved', decision: 'approve-once', scope: 'intent' }
      : { status: 'unavailable', reason: 'no bot owner is configured for this account, so nobody can approve it here' });
    const runtime = new TurnToolRuntime(fixture({ approval }), [tool(execute, 'always')]);
    runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
    const outcome = await runtime.execute('schedule_add', {}, 'i2');
    expect(outcome).toMatchObject({ status: 'denied', policy: 'approval', reason: expect.stringContaining('no bot owner') });
    expect(requests.map(request => request.purpose)).toEqual(['intent', 'authorization']);
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed when an authorization request is answered with an intent-only confirmation', async () => {
    const execute = vi.fn(async () => 'ran');
    const { approval } = port(() => ({ status: 'approved', decision: 'approve-once', scope: 'intent' }));
    const outcome = await new TurnToolRuntime(fixture({ approval }), [tool(execute, 'always', 'danger')]).execute('danger', {}, 'i3');
    expect(outcome).toMatchObject({ status: 'denied', policy: 'approval' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('lets an authority provenance approval cover the ordinary approval as before', async () => {
    const execute = vi.fn(async () => 'ran');
    const { approval, requests } = port(() => ({ status: 'approved', decision: 'approve-once' }));
    const runtime = new TurnToolRuntime(fixture({ approval }), [tool(execute, 'always')]);
    runtime.provenance.record({ kind: 'conversation_context' });
    await expect(runtime.execute('schedule_add', {}, 'i4')).resolves.toMatchObject({ status: 'completed' });
    expect(requests).toHaveLength(1);
  });
});

describe('approval prompt display and audit', () => {
  it('masks secrets in the prompt but executes and scopes the exact arguments', async () => {
    const execute = vi.fn(async () => 'ok');
    const { approval, requests } = port(() => ({ status: 'approved', decision: 'approve-once' }));
    const args = { url: 'https://example.com', apiKey: 'plain-value-1234', note: 'Bearer abcdefgh12345678' };
    await new TurnToolRuntime(fixture({ approval }), [tool(execute, 'always', 'danger')]).execute('danger', args, 'm1');
    expect(requests[0]!.question).toContain('"apiKey":"[redacted]"');
    expect(requests[0]!.question).not.toContain('plain-value-1234');
    expect(requests[0]!.question).not.toContain('abcdefgh12345678');
    expect(requests[0]!.scopeKey).toContain('plain-value-1234');
    expect(execute).toHaveBeenCalledWith(args, expect.anything());
  });

  it('records each turn prompt and each blocked approval as tool_approval', async () => {
    const records: DecisionEventInput[] = [];
    const audit = { record: (input: DecisionEventInput) => { records.push(input); } };
    const { approval } = port((input) => input.purpose === 'intent'
      ? { status: 'approved', decision: 'approve-once', scope: 'intent' }
      : { status: 'timed_out' });
    const runtime = new TurnToolRuntime(fixture({ approval }), [tool(vi.fn(), 'always')], { decisionAudit: audit });
    runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
    await runtime.execute('schedule_add', {}, 'a1');
    await new TurnToolRuntime(fixture({ unattended: true }), [tool(vi.fn(), 'always', 'danger')], { decisionAudit: audit })
      .execute('danger', {}, 'a2');
    expect(records.filter(record => record.kind === 'tool_approval').map(record => [record.kind, record.outcome, record.reasonCode, record.payload?.purpose])).toEqual([
      ['tool_approval', 'allow', 'tool_approval_approved', 'intent'],
      ['tool_approval', 'deny', 'tool_approval_timeout', 'authorization'],
      ['tool_approval', 'deny', 'tool_approval_unavailable', 'authorization'],
    ]);
    const approvals = records.filter(record => record.kind === 'tool_approval');
    expect(approvals[0]!.payload).toMatchObject({ channel: 'turn_prompt', scope: 'intent', tool: 'schedule_add' });
    expect(approvals[2]!.reasonDetail).toBe('unattended');
  });
});
