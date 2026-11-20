import { describe, expect, it } from 'vitest';
import type { ToolInvocationOrigin } from '@zhin.js/tool';
import { summarizeTraceSessions, TURN_TRACE_SESSION_CONVERSATION_LIMIT } from '../../src/trace/turn-trace-archive.js';
import { sanitizeOriginText, snapshotOrigin, turnOriginKey, turnOriginLabelOf, withScheduleJobLabel } from '../../src/trace/turn-origin-label.js';
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
      platform: 'sandbox', scopeKind: 'group', sceneLabel: '开发群', displayName: 'sandbox · 群 开发群',
    });
    expect(turnOriginLabelOf(im('private', 'u1'), 'Developer').displayName).toBe('sandbox · 私聊 Developer');
    expect(turnOriginLabelOf(im('group', 'g2')).sceneLabel).toBe('g2');
    expect(turnOriginLabelOf({ kind: 'schedule', jobId: 'sched_1' })).toEqual({
      scopeKind: 'schedule', sceneLabel: 'sched_1', displayName: '定时任务 sched_1',
    });
    expect(turnOriginLabelOf({ kind: 'http', sessionId: 'x' })).toEqual({ scopeKind: 'http', displayName: 'HTTP' });
    expect(turnOriginLabelOf(undefined)).toEqual({});
  });

  it('uses a schedule job label when the host resolves it', () => {
    const origin = { kind: 'schedule', jobId: 'sched_1' };
    const label = withScheduleJobLabel(turnOriginLabelOf(origin), origin, id => (id === 'sched_1' ? '每日早报' : undefined));
    expect(label).toEqual({ scopeKind: 'schedule', sceneLabel: '每日早报', displayName: '定时任务 每日早报' });
    // Deleted job: the id stays.
    expect(withScheduleJobLabel(turnOriginLabelOf(origin), origin, () => undefined).sceneLabel).toBe('sched_1');
  });

  it('records a bounded conversation name in the trace origin snapshot', () => {
    const snap = snapshotOrigin(im('group', 'g1', `  ${'群'.repeat(200)} `)) as Extract<ToolInvocationOrigin, { kind: 'im' }>;
    expect(snap.conversation?.name).toHaveLength(128);
  });
});

describe('platform-given names are cleaned (#1250 b63 A-1)', () => {
  it('escapes ESC sequences, line breaks, U+2028/2029 and bidi controls', () => {
    expect(sanitizeOriginText('\u001b[31m红色\u001b[0m')).toBe('\\u001b[31m红色\\u001b[0m');
    expect(sanitizeOriginText('一行\n二行\r\u2028三\u2029四')).toBe('一行\\u000a二行\\u000d\\u2028三\\u2029四');
    // Leading / trailing line breaks are whitespace: trimmed before escaping.
    expect(sanitizeOriginText('\n名\u2028')).toBe('名');
    expect(sanitizeOriginText('abc\u202Edef\u2066g\u2069\u202A\u202C')).toBe('abc\\u202edef\\u2066g\\u2069\\u202a\\u202c');
    expect(sanitizeOriginText('\u0085C1\u009b')).toBe('\\u0085C1\\u009b');
    expect(sanitizeOriginText('  ')).toBeUndefined();
    expect(sanitizeOriginText(42)).toBeUndefined();
  });

  it('cuts by code points, never inside a surrogate pair, and is idempotent', () => {
    const emoji = '😀'.repeat(200);
    const cut = sanitizeOriginText(emoji)!;
    expect([...cut]).toHaveLength(128);
    expect(cut).toBe('😀'.repeat(128));
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(cut)).toBe(false);
    const dirty = `\u001b]0;title\u0007${'名'.repeat(300)}`;
    expect(sanitizeOriginText(sanitizeOriginText(dirty))).toBe(sanitizeOriginText(dirty));
  });

  it('cleans the recorded conversation name, the requester name and old trace origins', async () => {
    const snap = snapshotOrigin(im('group', 'g1', '开发\u001b[2J群\n')) as Extract<ToolInvocationOrigin, { kind: 'im' }>;
    expect(snap.conversation?.name).toBe('开发\\u001b[2J群');
    expect(turnOriginLabelOf(im('private', 'u1'), 'Dev\u202Eeloper').displayName).toBe('sandbox · 私聊 Dev\\u202eeloper');
    // A trace written before names were cleaned: the summary's origin and label are cleaned.
    const [summary] = summarizeTraceSessions([trace('o', 'scene-task:v1:ffff', NOW, { origin: im('group', 'g1', '旧\u001b[31m群') })]);
    expect(summary!.display_name).toBe('sandbox · 群 旧\\u001b[31m群');
    expect((summary!.origin as Extract<ToolInvocationOrigin, { kind: 'im' }>).conversation?.name).toBe('旧\\u001b[31m群');
    const { ToolApprovalQueue } = await import('../../src/security/tool-approval-queue.js');
    const queue = new ToolApprovalQueue();
    const card = queue.enqueue({ toolName: 'group_kick', category: 'member', turnId: 't', args: {}, sessionKey: 'p', turnOrigin: im('private', 'u1'), requesterName: `\u001b[1m${'名'.repeat(300)}` });
    // 128 code points after escaping: `\u001b[1m` (9) + 119 名.
    expect(card.turnOriginLabel?.sceneLabel).toBe(`\\u001b[1m${'名'.repeat(119)}`);
    queue.dispose();
  });
});

describe('turn origin grouping (#1250 b63 A-2)', () => {
  it('groups a2a / mcp / http by kind only; IM chats and internal sources stay apart', () => {
    expect(turnOriginKey({ kind: 'a2a', taskId: 't1' })).toBe(turnOriginKey({ kind: 'a2a', taskId: 't2' }));
    expect(turnOriginKey({ kind: 'mcp', requestId: 'r1' })).toBe(turnOriginKey({ kind: 'mcp', requestId: 'r2' }));
    expect(turnOriginKey({ kind: 'http', sessionId: 's1' })).toBe(turnOriginKey({ kind: 'http', sessionId: 's2' }));
    expect(turnOriginKey({ kind: 'internal', source: 'heartbeat' })).not.toBe(turnOriginKey({ kind: 'internal', source: 'wake' }));
    expect(turnOriginKey(im('group', 'g1'))).not.toBe(turnOriginKey(im('group', 'g2')));
  });

  it('lists one chat for an A2A context with many tasks', () => {
    const traces = ['t1', 't2', 't3'].map((taskId, i) => trace(taskId, 'a2a-context:v1:abcd', NOW + i, { origin: { kind: 'a2a', taskId } }));
    const [summary] = summarizeTraceSessions(traces);
    expect(summary).toMatchObject({ turns: 3, scope_kind: 'a2a', display_name: 'A2A', origin: { kind: 'a2a', taskId: 't3' } });
    expect(summary!.conversations).toBeUndefined();
    const mixed = summarizeTraceSessions([...traces, trace('i', 'a2a-context:v1:abcd', NOW + 5, { origin: { kind: 'internal', source: 'heartbeat' } })]);
    expect(mixed[0]!.conversations?.map(c => [c.display_name, c.turns])).toEqual([['内部 heartbeat', 1], ['A2A', 3]]);
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
      platform: 'sandbox', scope_kind: 'private', scene_label: 'Developer', display_name: 'sandbox · 私聊 Developer',
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
    expect(summary!.display_name).toBe('sandbox · 群 一群');
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
    expect(job).toMatchObject({ scope_kind: 'schedule', scene_label: '每日早报', display_name: '定时任务 每日早报', origin: { jobId: 'sched_1' } });
    expect(group).toEqual(sessions[1]);
  });
});

describe('tool approval cards carry the turn origin (#1250 b63)', () => {
  it('labels a private request by the requester and falls back to the IM origin without a turn origin', async () => {
    const { ToolApprovalQueue } = await import('../../src/security/tool-approval-queue.js');
    const queue = new ToolApprovalQueue();
    const base = { toolName: 'group_kick', category: 'member' as const, turnId: 't', args: {} };
    const privateCard = queue.enqueue({ ...base, sessionKey: 'personal-session:v1:aa', turnOrigin: im('private', 'u1'), requesterName: 'Developer' });
    expect(privateCard.turnOriginLabel?.displayName).toBe('sandbox · 私聊 Developer');
    expect(privateCard.turnOrigin).toMatchObject({ kind: 'im', sceneId: 'u1' });
    const legacy = queue.enqueue({ ...base, sessionKey: 's2', origin: { platform: 'icqq', endpointKey: 'bot', scope: 'group', sceneId: '42' } });
    expect(legacy.turnOrigin).toBeUndefined();
    expect(legacy.turnOriginLabel?.displayName).toBe('icqq · 群 42');
    const bare = queue.enqueue({ ...base, sessionKey: 's3' });
    expect(bare.turnOriginLabel).toBeUndefined();
    queue.dispose();
  });
});
