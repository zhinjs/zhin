/**
 * #1250 `confirm-every-step-no-batch`: one confirmation in a turn covers later calls of the same
 * initiator, high-risk category and target; anything else asks again.
 */
import { describe, expect, it, vi } from 'vitest';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import type { ToolCapability } from '../../src/plugin-runtime/capability-ingress.js';
import { PROVENANCE_POLICY } from '../../src/security/provenance.js';
import {
  TurnHighRiskConfirmations,
  confirmationCoversAuthority,
  highRiskConfirmationTarget,
} from '../../src/security/high-risk-confirmation-batch.js';
import type { ApprovalOutcome, ApprovalOutcomePort, ApprovalRequestInput } from '../../src/session/approval-port.js';
import { TurnToolRuntime } from '../../src/tool/turn-tool-runtime.js';
import { createTurnIngress } from '../../src/turn/turn-ingress.js';

const idSchema = { type: 'object', properties: { id: { type: 'string' }, cron: { type: 'string' } } };

function capability(name: string, extra: Partial<ToolCapability> = {}): ToolCapability {
  return { owner: rootPluginId(), name, qualifiedName: name, description: name, requiresApproval: 'never',
    source: `/tools/${name}.ts`, execute: vi.fn(async () => 'ok'), inputSchema: idSchema as never, ...extra };
}

function port(answer: (request: ApprovalRequestInput) => ApprovalOutcome = () => ({ status: 'approved', decision: 'approve-once' })) {
  const requests: ApprovalRequestInput[] = [];
  const approval: ApprovalOutcomePort = {
    available: true,
    intentAvailable: true,
    requestApproval: async () => true,
    requestApprovalOutcome: async (request) => { requests.push(request); return answer(request); },
  };
  return { approval, requests };
}

function turn(approval: ApprovalOutcomePort, turnId = 'turn-1') {
  return createTurnIngress({
    intent: { kind: 'new' },
    identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId },
    origin: { kind: 'http', sessionId: 's' },
    principal: { subjectId: 'owner', roles: ['owner'] },
    input: { text: '改一下定时任务' },
    session: { key: 'http:s' },
    policy: { permissions: ['owner'], unattended: false },
    capabilities: { tools: [], skills: [] },
    signal: new AbortController().signal,
    ports: { journal: { append: () => undefined }, approval },
  });
}

function tainted(runtime: TurnToolRuntime): TurnToolRuntime {
  runtime.provenance.record({ kind: 'tool_result', toolName: 'web_fetch' });
  return runtime;
}

describe('TurnToolRuntime batches provenance confirmations within a turn (#1250)', () => {
  it('asks once for repeated calls on the same target in the same category', async () => {
    const { approval, requests } = port();
    const runtime = tainted(new TurnToolRuntime(turn(approval),
      [capability('schedule_update'), capability('schedule_pause')]));
    await expect(runtime.execute('schedule_update', { id: 'job-1', cron: '0 0 8 * * *' }, 'a')).resolves.toMatchObject({ status: 'completed' });
    await expect(runtime.execute('schedule_update', { id: 'job-1', cron: '0 0 7 * * *' }, 'b')).resolves.toMatchObject({ status: 'completed' });
    await expect(runtime.execute('schedule_pause', { id: 'job-1' }, 'c')).resolves.toMatchObject({ status: 'completed' });
    expect(requests).toHaveLength(1);
  });

  it('asks again for another target', async () => {
    const { approval, requests } = port();
    const runtime = tainted(new TurnToolRuntime(turn(approval), [capability('schedule_remove')]));
    await runtime.execute('schedule_remove', { id: 'job-1' }, 'a');
    await runtime.execute('schedule_remove', { id: 'job-2' }, 'b');
    expect(requests).toHaveLength(2);
  });

  it('asks again for another category on the same target', async () => {
    const { approval, requests } = port();
    const runtime = tainted(new TurnToolRuntime(turn(approval), [capability('schedule_update'), capability('update_config')]));
    await runtime.execute('schedule_update', { id: 'x' }, 'a');
    await runtime.execute('update_config', { id: 'x' }, 'b');
    expect(requests.map(request => request.toolName)).toEqual(['schedule_update', 'update_config']);
  });

  it('asks again in a new turn (the record is turn memory only)', async () => {
    const { approval, requests } = port();
    const tools = [capability('schedule_update')];
    await tainted(new TurnToolRuntime(turn(approval, 'turn-1'), tools)).execute('schedule_update', { id: 'job-1' }, 'a');
    await tainted(new TurnToolRuntime(turn(approval, 'turn-2'), tools)).execute('schedule_update', { id: 'job-1' }, 'a');
    expect(requests).toHaveLength(2);
  });

  it('does not record a denied or timed-out confirmation', async () => {
    let answer: ApprovalOutcome = { status: 'denied', by: 'user' };
    const { approval, requests } = port(() => answer);
    const execute = vi.fn(async () => 'ok');
    const runtime = tainted(new TurnToolRuntime(turn(approval), [capability('schedule_update', { execute })]));
    await expect(runtime.execute('schedule_update', { id: 'job-1' }, 'a')).resolves.toMatchObject({ status: 'denied', policy: PROVENANCE_POLICY });
    answer = { status: 'timed_out' };
    await expect(runtime.execute('schedule_update', { id: 'job-1' }, 'b')).resolves.toMatchObject({ status: 'denied' });
    answer = { status: 'approved', decision: 'approve-once' };
    await runtime.execute('schedule_update', { id: 'job-1' }, 'c');
    expect(requests).toHaveLength(3);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('asks again for each call of a human-only tool', async () => {
    const { approval, requests } = port();
    const runtime = tainted(new TurnToolRuntime(turn(approval), [capability('schedule_update', { requiresApproval: 'human' })]));
    await runtime.execute('schedule_update', { id: 'job-1' }, 'a');
    await runtime.execute('schedule_update', { id: 'job-1' }, 'b');
    expect(requests.filter(request => request.purpose === 'intent')).toHaveLength(2);
  });

  it('does not let an argument the tool does not declare make two calls share a target', async () => {
    const { approval, requests } = port();
    // bash declares only `command`: an injected `id` does not turn two commands into one target.
    const runtime = tainted(new TurnToolRuntime(turn(approval), [capability('bash_like', {
      tags: ['shell'], inputSchema: { type: 'object', properties: { command: { type: 'string' } } } as never,
    })]));
    await runtime.execute('bash_like', { command: 'ls', id: 'same' }, 'a');
    await runtime.execute('bash_like', { command: 'rm -rf data', id: 'same' }, 'b');
    await runtime.execute('bash_like', { command: 'ls', id: 'same' }, 'c');
    expect(requests).toHaveLength(2);
  });

  it('covers an intent-only answer for intent only: the ordinary approval still runs', async () => {
    const { approval, requests } = port(request => request.purpose === 'intent'
      ? { status: 'approved', decision: 'approve-once', scope: 'intent' }
      : { status: 'approved', decision: 'approve-once' });
    const runtime = tainted(new TurnToolRuntime(turn(approval), [capability('schedule_update', { requiresApproval: 'always' })]));
    await runtime.execute('schedule_update', { id: 'job-1' }, 'a');
    await runtime.execute('schedule_update', { id: 'job-1' }, 'b');
    // a: intent + authorization; b: intent covered, authorization asked again.
    expect(requests.map(request => request.purpose)).toEqual(['intent', 'authorization', 'authorization']);
  });

  it('lets an authority answer also cover the same authorization later in the turn', async () => {
    const { approval, requests } = port();
    const runtime = tainted(new TurnToolRuntime(turn(approval), [capability('schedule_update', { requiresApproval: 'always' })]));
    await runtime.execute('schedule_update', { id: 'job-1' }, 'a');
    await runtime.execute('schedule_update', { id: 'job-1' }, 'b');
    expect(requests.map(request => request.purpose)).toEqual(['intent']);
  });

  it('does not let a confirmation of a call that needed no authorization cover one that does', async () => {
    const { approval, requests } = port();
    const runtime = tainted(new TurnToolRuntime(turn(approval), [
      capability('schedule_pause'),
      capability('schedule_update', { requiresApproval: 'always' }),
    ]));
    await runtime.execute('schedule_pause', { id: 'job-1' }, 'a');
    await runtime.execute('schedule_update', { id: 'job-1' }, 'b');
    expect(requests.map(request => request.purpose)).toEqual(['intent', 'authorization']);
  });
});

describe('merged turns: each initiator confirms for themselves (#1250)', () => {
  it('asks again when another sender acts on the same target', async () => {
    const { approval, requests } = port();
    const members = [
      { subjectId: 'alice', roles: ['owner'], tools: ['schedule_update'] },
      { subjectId: 'bob', roles: ['owner'], tools: ['schedule_update'] },
    ];
    const merged = createTurnIngress({
      intent: { kind: 'new' },
      identity: { rootId: 'root', generation: 1, traceId: 'trace', turnId: 'merged' },
      origin: { kind: 'http', sessionId: 's' },
      principal: { subjectId: 'alice', roles: ['owner'] },
      input: { text: 'x' },
      session: { key: 'http:s' },
      policy: { permissions: ['owner'], unattended: false, merge: { members } as never },
      capabilities: { tools: [], skills: [] },
      signal: new AbortController().signal,
      ports: { journal: { append: () => undefined }, approval },
    });
    const runtime = tainted(new TurnToolRuntime(merged, [capability('schedule_update')]));
    await runtime.execute('schedule_update', { id: 'job-1', onBehalfOf: 'alice' }, 'a');
    await runtime.execute('schedule_update', { id: 'job-1', onBehalfOf: 'alice' }, 'b');
    await runtime.execute('schedule_update', { id: 'job-1', onBehalfOf: 'bob' }, 'c');
    expect(requests.map(request => request.requesterId)).toEqual(['alice', 'bob']);
  });
});

describe('TurnHighRiskConfirmations', () => {
  const base = { turnId: 't', requesterId: 'u', kind: 'schedule' as const, target: 'x' };

  it('keys on turn, initiator, category and target', () => {
    const confirmations = new TurnHighRiskConfirmations();
    confirmations.record(base, 'admin');
    expect(confirmations.covering(base)).toBe('admin');
    for (const other of [{ turnId: 't2' }, { requesterId: 'v' }, { kind: 'config' as const }, { target: 'y' }]) {
      expect(confirmations.covering({ ...base, ...other })).toBeUndefined();
    }
  });

  it('never weakens a stronger record', () => {
    const confirmations = new TurnHighRiskConfirmations();
    confirmations.record(base, 'owner');
    confirmations.record(base, 'intent');
    expect(confirmations.covering(base)).toBe('owner');
  });

  it('covers only up to the recorded authority', () => {
    expect(confirmationCoversAuthority('intent', 'admin')).toBe(false);
    expect(confirmationCoversAuthority('admin', 'admin')).toBe(true);
    expect(confirmationCoversAuthority('admin', 'owner')).toBe(false);
    expect(confirmationCoversAuthority('owner', 'owner')).toBe(true);
  });

  it('derives the target from declared identifying arguments, else from the whole call', () => {
    const tool = { name: 'schedule_update', owner: 'p', inputSchema: idSchema };
    expect(highRiskConfirmationTarget(tool, { id: 'a', cron: '1' })).toBe(highRiskConfirmationTarget(tool, { id: 'a', cron: '2' }));
    expect(highRiskConfirmationTarget(tool, { id: 'a' })).not.toBe(highRiskConfirmationTarget(tool, { id: 'b' }));
    // Another plugin's job with the same id is another target.
    expect(highRiskConfirmationTarget(tool, { id: 'a' })).not.toBe(highRiskConfirmationTarget({ ...tool, owner: 'q' }, { id: 'a' }));
    // A non-primitive id falls back to the exact call.
    expect(highRiskConfirmationTarget(tool, { id: { x: 1 } })).toMatch(/^call:/);
    const undeclared = { name: 'run', owner: 'p' };
    expect(highRiskConfirmationTarget(undeclared, { id: 'a', x: 1 })).not.toBe(highRiskConfirmationTarget(undeclared, { id: 'a', x: 2 }));
  });
});
