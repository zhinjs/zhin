import { describe, expect, it } from 'vitest';
import type { ToolInvocationOrigin } from '@zhin.js/tool';
import { summarizeTraceSessions, TURN_TRACE_SESSION_CONVERSATION_LIMIT } from '../../src/trace/turn-trace-archive.js';
import { snapshotOrigin, turnOriginLabelOf, withScheduleJobLabel } from '../../src/trace/turn-origin-label.js';
import type { TurnTrace } from '../../src/trace/turn-trace.js';

const NOW = Date.parse('2026-11-19T08:00:00Z');

function trace(turnId: string, sessionKey: string, startedAt: number, extra: Partial<TurnTrace> = {}): TurnTrace {
  return {
    version: 1, turn_id: turnId, session_key: sessionKey, started_at: startedAt, duration_ms: 5,
    model_calls: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, tool_calls: [],
    budget: { extensions: [], continuations: 0 }, subagents: [], timeline: [],
    termination: { status: 'completed' }, dropped: 0, ...extra,
  };
}

function im(scope: 'private' | 'group', sceneId: string, name?: string): ToolInvocationOrigin {
  return {
    kind: 'im', platform: 'sandbox', endpoint: 'bot', scope, sceneId,
    conversation: { endpoint: { adapter: 'sandbox', id: 'bot' }, kind: scope, id: sceneId, ...(name ? { name } : {}) },
  };
}

describe('turn origin labels (#1250 b63)', () => {
  it('names IM chats, private peers, schedules and other origins', () => {
    expect(turnOriginLabelOf(im('group', 'g1', '开发群'))).toEqual({
      platform: 'sandbox', scopeKind: 'group', sceneLabel: '开发群', displayName: 'sandbox · 群聊 · 开发群',
    });
    expect(turnOriginLabelOf(im('private', 'u1'), 'Developer').displayName).toBe('sandbox · 私聊 · Developer');
    expect(turnOriginLabelOf(im('group', 'g2')).sceneLabel).toBe('g2');
    expect(turnOriginLabelOf({ kind: 'schedule', jobId: 'sched_1' })).toEqual({
      scopeKind: 'schedule', sceneLabel: 'sched_1', displayName: '定时任务 · sched_1',
    });
    expect(turnOriginLabelOf({ kind: 'http', sessionId: 'x' })).toEqual({ scopeKind: 'http', displayName: 'HTTP' });
    expect(turnOriginLabelOf(undefined)).toEqual({});
  });

  it('uses a schedule job label when the host resolves it', () => {
    const origin = { kind: 'schedule', jobId: 'sched_1' };
    const label = withScheduleJobLabel(turnOriginLabelOf(origin), origin, id => (id === 'sched_1' ? '每日早报' : undefined));
    expect(label).toEqual({ scopeKind: 'schedule', sceneLabel: '每日早报', displayName: '定时任务 · 每日早报' });
    // Deleted job: the id stays.
    expect(withScheduleJobLabel(turnOriginLabelOf(origin), origin, () => undefined).sceneLabel).toBe('sched_1');
  });

  it('records a bounded conversation name in the trace origin snapshot', () => {
    const snap = snapshotOrigin(im('group', 'g1', `  ${'群'.repeat(200)} `)) as Extract<ToolInvocationOrigin, { kind: 'im' }>;
    expect(snap.conversation?.name).toHaveLength(128);
  });
});

describe('trace session summaries (#1250 b63)', () => {
  it('carries the latest origin and label; older traces without one degrade', () => {
    const [legacy, labelled] = [
      summarizeTraceSessions([trace('a', 'personal-session:v1:aaaa', NOW)]),
      summarizeTraceSessions([
        trace('b1', 'personal-session:v1:bbbb', NOW - 10, { origin: im('private', 'u1'), principal: { subject_id: 'u1', display_name: 'Developer', roles: [] } }),
        trace('b2', 'personal-session:v1:bbbb', NOW),
      ]),
    ];
    expect(legacy[0]).toEqual({
      session_key: 'personal-session:v1:aaaa', turns: 1, first_started_at: NOW, last_started_at: NOW,
      last_status: 'completed', total_tokens: 2,
    });
    expect(labelled[0]).toMatchObject({
      turns: 2, last_started_at: NOW,
      origin: { kind: 'im', scope: 'private', sceneId: 'u1' },
      platform: 'sandbox', scope_kind: 'private', scene_label: 'Developer', display_name: 'sandbox · 私聊 · Developer',
    });
    expect(labelled[0]!.conversations).toBeUndefined();
  });

  it('lists the chats of a session spanning several, most recent first and capped', () => {
    const traces = [
      trace('t1', 'scene-task:v1:cccc', NOW - 30, { origin: im('group', 'g1', '一群') }),
      trace('t2', 'scene-task:v1:cccc', NOW - 20, { origin: im('group', 'g2', '二群') }),
      trace('t3', 'scene-task:v1:cccc', NOW - 10, { origin: im('group', 'g1', '一群') }),
    ];
    const [summary] = summarizeTraceSessions(traces);
    expect(summary!.display_name).toBe('sandbox · 群聊 · 一群');
    expect(summary!.conversations?.[0]).toMatchObject({ origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', sceneId: 'g1' }, scope_kind: 'group' });
    expect(summary!.conversations?.map(c => [c.scene_label, c.turns, c.last_started_at])).toEqual([
      ['一群', 2, NOW - 10], ['二群', 1, NOW - 20],
    ]);
    expect(summary!.conversations_total).toBeUndefined();

    const many = Array.from({ length: TURN_TRACE_SESSION_CONVERSATION_LIMIT + 3 }, (_, i) =>
      trace(`m${i}`, 'scene-task:v1:dddd', NOW + i, { origin: im('group', `g${i}`) }));
    const [capped] = summarizeTraceSessions(many);
    expect(capped!.conversations).toHaveLength(TURN_TRACE_SESSION_CONVERSATION_LIMIT);
    expect(capped!.conversations![0]!.scene_label).toBe(`g${TURN_TRACE_SESSION_CONVERSATION_LIMIT + 2}`);
    expect(capped!.conversations_total).toBe(TURN_TRACE_SESSION_CONVERSATION_LIMIT + 3);
  });
});

describe('withSessionScheduleLabels (#1250 b63)', () => {
  it('renames schedule sessions and keeps others', async () => {
    const { withSessionScheduleLabels } = await import('../../src/trace/turn-trace-archive.js');
    const sessions = summarizeTraceSessions([
      trace('j', 'schedule:sched_1', NOW, { origin: { kind: 'schedule', jobId: 'sched_1' } }),
      trace('g', 'scene-task:v1:eeee', NOW - 1, { origin: im('group', 'g1', '一群') }),
    ]);
    const [job, group] = withSessionScheduleLabels(sessions, id => (id === 'sched_1' ? '每日早报' : undefined));
    expect(job).toMatchObject({ scope_kind: 'schedule', scene_label: '每日早报', display_name: '定时任务 · 每日早报', origin: { jobId: 'sched_1' } });
    expect(group).toEqual(sessions[1]);
  });
});

describe('tool approval cards carry the turn origin (#1250 b63)', () => {
  it('labels a private request by the requester and falls back to the IM origin without a turn origin', async () => {
    const { ToolApprovalQueue } = await import('../../src/security/tool-approval-queue.js');
    const queue = new ToolApprovalQueue();
    const base = { toolName: 'group_kick', category: 'member' as const, turnId: 't', args: {} };
    const privateCard = queue.enqueue({ ...base, sessionKey: 'personal-session:v1:aa', turnOrigin: im('private', 'u1'), requesterName: 'Developer' });
    expect(privateCard.turnOriginLabel?.displayName).toBe('sandbox · 私聊 · Developer');
    expect(privateCard.turnOrigin).toMatchObject({ kind: 'im', sceneId: 'u1' });
    const legacy = queue.enqueue({ ...base, sessionKey: 's2', origin: { platform: 'icqq', endpointKey: 'bot', scope: 'group', sceneId: '42' } });
    expect(legacy.turnOrigin).toBeUndefined();
    expect(legacy.turnOriginLabel?.displayName).toBe('icqq · 群聊 · 42');
    const bare = queue.enqueue({ ...base, sessionKey: 's3' });
    expect(bare.turnOriginLabel).toBeUndefined();
    queue.dispose();
  });
});
