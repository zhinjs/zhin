import { afterEach, describe, expect, it, vi } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { defineAgentTool } from '@zhin.js/tool';
import type { TurnEvent } from '../../src/event/turn-event.js';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';
import { createDecisionEvent, type DecisionEventInput, type DecisionEventRecord } from '../../src/decision-events.js';
import type { ApprovalOutcome, ApprovalOutcomePort, ApprovalRequestInput } from '../../src/session/approval-port.js';
import { createBypassApprovalPort } from '../../src/session/approval-review-agent.js';
import {
  CORE_DANGEROUS_TOOLS,
  TOOL_HARD_GATE_POLICY,
  assessToolRisk,
  resolveToolHardGate,
  toolLocalName,
} from '../../src/security/tool-hard-gate.js';
import { ToolApprovalQueue } from '../../src/security/tool-approval-queue.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('assessToolRisk', () => {
  it('matches the core list by local name of a qualified tool name', () => {
    expect(toolLocalName('icqq__agents__icqq__skills__icqq-group-admin__group_kick')).toBe('group_kick');
    expect(assessToolRisk({ name: 'icqq__agents__icqq__skills__icqq-group-admin__group_kick' }))
      .toEqual({ risk: 'dangerous', category: 'member', source: 'core' });
    expect(CORE_DANGEROUS_TOOLS.get('send_group_notice')).toBe('publish');
    expect(CORE_DANGEROUS_TOOLS.get('send_red_packet')).toBe('funds');
    expect(CORE_DANGEROUS_TOOLS.get('set_avatar')).toBe('identity');
  });

  it('never lets a declaration lower a core dangerous tool', () => {
    expect(assessToolRisk({ name: 'set_mute', risk: 'safe' }).risk).toBe('dangerous');
  });

  it('honours declared dangerous tools and their category', () => {
    expect(assessToolRisk({ name: 'wipe_group_album', risk: 'dangerous', riskCategory: 'publish' }))
      .toEqual({ risk: 'dangerous', category: 'publish', source: 'declared' });
  });

  it('lets the Host raise a tool to dangerous but not lower one', () => {
    const settings = resolveToolHardGate({ dangerousTools: ['weather'] });
    expect(assessToolRisk({ name: 'plugin__weather', risk: 'safe' }, settings)).toMatchObject({ risk: 'dangerous', source: 'host' });
    expect(assessToolRisk({ name: 'get_group_members' }, settings)).toEqual({ risk: 'safe', category: null, source: 'default' });
  });

  it('defaults: funds disabled, five-minute approval timeout', () => {
    expect(resolveToolHardGate()).toEqual({ dangerousTools: [], allowFunds: false, approvalTimeoutMs: 300_000 });
    expect(resolveToolHardGate({ approvalTimeoutMs: -1, allowFunds: true }).approvalTimeoutMs).toBe(300_000);
  });
});

describe('defineAgentTool risk declaration', () => {
  it('accepts risk and riskCategory and rejects unknown values', () => {
    const tool = defineAgentTool({ description: 'kick', risk: 'dangerous', riskCategory: 'member', execute: () => 'ok' });
    expect(tool).toMatchObject({ risk: 'dangerous', riskCategory: 'member' });
    expect(() => defineAgentTool({ description: 'x', risk: 'low' as never, execute: () => 'ok' })).toThrow(/risk/);
    expect(() => defineAgentTool({ description: 'x', riskCategory: 'money' as never, execute: () => 'ok' })).toThrow(/riskCategory/);
  });
});

describe('TurnToolRuntime hard gate', () => {
  it('is not execApprovalMode: bypass cannot run a dangerous tool, the call fails closed', async () => {
    const execute = vi.fn(async () => 'kicked');
    const { turn, events } = fixture({ approval: createBypassApprovalPort() });
    const runtime = new TurnToolRuntime(turn, [tool('group_kick', execute, 'never')]);

    const outcome = await runtime.execute('group_kick', { user_id: 1 }, 'tu-1');

    expect(execute).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: 'denied', policy: TOOL_HARD_GATE_POLICY });
    expect((outcome as { reason: string }).reason).toContain('不要重试');
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_denied', policy: TOOL_HARD_GATE_POLICY }));
  });

  it('asks once for fresh human approval and runs exactly the approved arguments', async () => {
    const execute = vi.fn(async () => 'kicked');
    const port = scriptedPort([{ status: 'approved', decision: 'approve-once' }]);
    const { turn } = fixture({ approval: port });
    const runtime = new TurnToolRuntime(turn, [tool('group_kick', execute, 'always')]);
    const args = { group_id: 10, user_id: 1, reason: 'spam' };

    await expect(runtime.execute('group_kick', args, 'tu-1')).resolves.toMatchObject({ status: 'completed' });

    expect(port.requests).toHaveLength(1);
    expect(port.requests[0]).toMatchObject({ humanOnly: true, toolName: 'group_kick', timeoutMs: 300_000 });
    expect(port.requests[0]!.question).toContain('"user_id":1');
    expect(port.requests[0]!.question).toContain('成员管理');
    expect(port.requests[0]!.scopeKey).toContain(TOOL_HARD_GATE_POLICY);
    expect(execute).toHaveBeenCalledWith(args, expect.anything());
  });

  it('does not ask again in the same turn after a denial, even with new arguments or a sibling tool', async () => {
    const kick = vi.fn(async () => 'kicked');
    const mute = vi.fn(async () => 'muted');
    const port = scriptedPort([{ status: 'denied', by: 'user' }]);
    const audit = auditSink();
    const { turn } = fixture({ approval: port });
    const runtime = new TurnToolRuntime(turn, [tool('group_kick', kick, 'never'), tool('set_mute', mute, 'never')], { decisionAudit: audit });

    await expect(runtime.execute('group_kick', { user_id: 1 }, 'tu-1')).resolves.toMatchObject({ status: 'denied' });
    await expect(runtime.execute('group_kick', { user_id: 2 }, 'tu-2')).resolves.toMatchObject({ status: 'denied' });
    await expect(runtime.execute('set_mute', { user_id: 1 }, 'tu-3')).resolves.toMatchObject({ status: 'denied' });

    expect(port.requests).toHaveLength(1);
    expect(kick).not.toHaveBeenCalled();
    expect(mute).not.toHaveBeenCalled();
    expect(audit.codes()).toEqual([
      'tool_approval:defer:tool_approval_requested',
      'tool_approval:deny:tool_approval_denied',
      'tool_hard_gate:deny:tool_approval_denied',
      'tool_hard_gate:deny:tool_hard_gate_latched',
      'tool_hard_gate:deny:tool_hard_gate_latched',
    ]);
  });

  it('times out to a denial', async () => {
    const port = scriptedPort([]);
    const audit = auditSink();
    // The owner passes the trust-level policy; the hard gate still applies to them.
    const { turn } = fixture({ approval: port, roles: ['master'] });
    const execute = vi.fn(async () => 'posted');
    const runtime = new TurnToolRuntime(turn, [tool('send_group_notice', execute, 'never')], {
      hardGate: { approvalTimeoutMs: 20 },
      decisionAudit: audit,
    });

    const outcome = await runtime.execute('send_group_notice', { content: 'hi' }, 'tu-1');

    expect(outcome).toMatchObject({ status: 'denied', policy: TOOL_HARD_GATE_POLICY });
    expect((outcome as { reason: string }).reason).toContain('审批超时');
    expect(execute).not.toHaveBeenCalled();
    expect(audit.codes()).toContain('tool_hard_gate:deny:tool_approval_timeout');
  });

  it('fails closed in unattended turns, leaves a Console card, and runs it once after an operator approves', async () => {
    const queue = new ToolApprovalQueue();
    const audit = auditSink();
    const execute = vi.fn(async () => 'kicked');
    const capabilities = [tool('group_kick', execute, 'never')];
    const first = new TurnToolRuntime(fixture({ unattended: true }).turn, capabilities, { approvalQueue: queue, decisionAudit: audit });

    await expect(first.execute('group_kick', { user_id: 1 }, 'tu-1')).resolves.toMatchObject({ status: 'denied' });
    const [card] = queue.list({ status: 'pending' });
    expect(card).toMatchObject({ toolName: 'group_kick', category: 'member', args: { user_id: 1 } });
    expect(audit.codes()).toEqual([
      'tool_approval:defer:tool_approval_requested',
      'tool_hard_gate:deny:tool_dangerous_no_approval',
    ]);

    // A retry before anyone approved reuses the same card instead of stacking new ones.
    const retry = new TurnToolRuntime(fixture({ unattended: true, turnId: 'turn-2' }).turn, capabilities, { approvalQueue: queue });
    await expect(retry.execute('group_kick', { user_id: 1 }, 'tu-2')).resolves.toMatchObject({ status: 'denied' });
    expect(queue.list({ status: 'pending' })).toHaveLength(1);

    expect(queue.resolve(card!.id, true, 'console-admin')).toMatchObject({ status: 'approved', decidedBy: 'console-admin' });

    const other = new TurnToolRuntime(fixture({ unattended: true, turnId: 'turn-3' }).turn, capabilities, { approvalQueue: queue });
    await expect(other.execute('group_kick', { user_id: 2 }, 'tu-3')).resolves.toMatchObject({ status: 'denied' });
    expect(execute).not.toHaveBeenCalled();

    const approved = new TurnToolRuntime(fixture({ unattended: true, turnId: 'turn-4' }).turn, capabilities, { approvalQueue: queue, decisionAudit: audit });
    await expect(approved.execute('group_kick', { user_id: 1 }, 'tu-4')).resolves.toMatchObject({ status: 'completed' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(audit.records.at(-2)).toMatchObject({ kind: 'tool_approval', outcome: 'allow', reasonCode: 'tool_approval_approved', actor: 'operator', actorId: 'console-admin' });
    expect(audit.records.at(-1)).toMatchObject({ kind: 'tool_hard_gate', outcome: 'allow', reasonCode: 'tool_approval_approved', actor: 'policy' });

    // The approval is one-shot.
    const again = new TurnToolRuntime(fixture({ unattended: true, turnId: 'turn-5' }).turn, capabilities, { approvalQueue: queue });
    await expect(again.execute('group_kick', { user_id: 1 }, 'tu-5')).resolves.toMatchObject({ status: 'denied' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('lets a Console decision settle a call that is waiting on the IM prompt', async () => {
    const queue = new ToolApprovalQueue();
    const port = scriptedPort([]);
    const execute = vi.fn(async () => 'done');
    const { turn } = fixture({ approval: port });
    const runtime = new TurnToolRuntime(turn, [tool('set_avatar', execute, 'never')], { approvalQueue: queue });

    const pending = runtime.execute('set_avatar', { url: 'https://example.test/a.png' }, 'tu-1');
    await vi.waitFor(() => expect(queue.list({ status: 'pending' })).toHaveLength(1));
    queue.resolve(queue.list({ status: 'pending' })[0]!.id, true, 'op-1');

    await expect(pending).resolves.toMatchObject({ status: 'completed' });
    expect(port.aborted()).toBe(true);
    expect(queue.list()[0]!.status).toBe('consumed');
  });

  it('keeps funds tools disabled unless the Host enables them, then still asks', async () => {
    const execute = vi.fn(async () => 'paid');
    const port = scriptedPort([{ status: 'approved', decision: 'approve-once' }]);
    const disabled = new TurnToolRuntime(fixture({ approval: port, roles: ['master'] }).turn, [tool('send_red_packet', execute, 'never')]);
    await expect(disabled.execute('send_red_packet', { amount: 1 }, 'tu-1')).resolves.toMatchObject({ status: 'denied' });
    expect(port.requests).toHaveLength(0);

    const enabled = new TurnToolRuntime(fixture({ approval: port, roles: ['master'] }).turn, [tool('send_red_packet', execute, 'never')], {
      hardGate: { allowFunds: true },
    });
    await expect(enabled.execute('send_red_packet', { amount: 1 }, 'tu-2')).resolves.toMatchObject({ status: 'completed' });
    expect(port.requests).toHaveLength(1);
  });

  it('leaves safe tools on the ordinary approval path', async () => {
    const execute = vi.fn(async () => 'members');
    const port = scriptedPort([]);
    const audit = auditSink();
    const runtime = new TurnToolRuntime(fixture({ approval: port }).turn, [tool('get_group_members', execute, 'never')], { decisionAudit: audit });
    await expect(runtime.execute('get_group_members', {}, 'tu-1')).resolves.toMatchObject({ status: 'completed' });
    expect(port.requests).toHaveLength(0);
    // Read-only queries are allowed but still audited (ADR 0036).
    expect(audit.codes()).toEqual(['tool_call:allow:tool_safe_allowed']);
  });

  it('never lets an audit failure change the decision', async () => {
    const execute = vi.fn(async () => 'kicked');
    const port = scriptedPort([{ status: 'approved', decision: 'approve-once' }]);
    const runtime = new TurnToolRuntime(fixture({ approval: port }).turn, [tool('group_kick', execute, 'never')], {
      decisionAudit: { record: () => { throw new Error('db down'); } },
    });
    await expect(runtime.execute('group_kick', { user_id: 1 }, 'tu-1')).resolves.toMatchObject({ status: 'completed' });
  });
});

describe('ToolApprovalQueue', () => {
  it('expires pending cards after the ttl', async () => {
    vi.useFakeTimers();
    const queue = new ToolApprovalQueue({ ttlMs: 1_000 });
    const card = queue.enqueue({ toolName: 'set_mute', category: 'member', sessionKey: 's', turnId: 't', args: { token: 'secret-value' } });
    expect(card.args).toEqual({ token: '[redacted]' });
    const settled = queue.wait(card.id);
    vi.advanceTimersByTime(1_001);
    await expect(settled).resolves.toBe('expired');
    expect(queue.resolve(card.id, true, 'op')).toBeUndefined();
  });
});

function tool(name: string, execute: (...args: any[]) => Promise<unknown>, requiresApproval: ToolCapability['requiresApproval']): ToolCapability {
  return {
    owner: rootPluginId(),
    name,
    qualifiedName: name,
    description: name,
    requiresApproval,
    source: `/tools/${name}.ts`,
    execute: execute as ToolCapability['execute'],
  };
}

function fixture(options: { approval?: ApprovalOutcomePort; unattended?: boolean; turnId?: string; roles?: string[] } = {}) {
  const events: TurnEvent[] = [];
  const turn = createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: options.turnId ?? 'turn' },
    origin: { kind: 'im', platform: 'icqq', endpoint: '10001', scope: 'group', sceneId: '42' },
    principal: { subjectId: 'user-1', roles: options.roles ?? ['user'] },
    input: { text: 'run' },
    session: { key: 'icqq:10001:group:42' },
    policy: { permissions: options.roles ?? ['user'], unattended: options.unattended ?? false },
    capabilities: { tools: [], skills: [] },
    signal: new AbortController().signal,
    ports: {
      journal: { append: (event) => { events.push(event); } },
      ...(options.approval && !options.unattended ? { approval: options.approval } : {}),
    },
  });
  return { turn, events };
}

/** Answers with the scripted outcomes in order; with none left it never answers (until aborted). */
function scriptedPort(outcomes: ApprovalOutcome[]) {
  const requests: ApprovalRequestInput[] = [];
  let aborted = false;
  const port: ApprovalOutcomePort & { requests: ApprovalRequestInput[]; aborted(): boolean } = {
    available: true,
    requests,
    aborted: () => aborted,
    requestApproval: async () => false,
    requestApprovalOutcome: (input) => {
      requests.push(input);
      const next = outcomes.shift();
      if (next) return Promise.resolve(next);
      return new Promise((resolve) => {
        input.signal.addEventListener('abort', () => {
          aborted = true;
          resolve({ status: 'unavailable', reason: 'aborted' });
        }, { once: true });
      });
    },
  };
  return port;
}

function auditSink() {
  const records: DecisionEventRecord[] = [];
  return {
    records,
    // Validates every row the same way the slice-B writer does.
    record(input: DecisionEventInput) { records.push(createDecisionEvent(input)); },
    codes: () => records.map((record) => `${record.kind}:${record.outcome}:${record.reasonCode}`),
  };
}
