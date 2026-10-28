import { describe, expect, it } from 'vitest';
import {
  AI_DECISION_EVENT_MODEL,
  DECISION_ACTORS,
  DECISION_EVENT_KINDS,
  DECISION_OUTCOMES,
  DECISION_REASON_CODES,
  DEPRECATED_DECISION_REASON_CODES,
  DecisionEventValidationError,
  MAX_DECISION_PAYLOAD_CHARS,
  MAX_REASON_DETAIL_CHARS,
  createDecisionEvent,
  decisionEventFromRow,
  decisionEventToExport,
  decisionEventToRow,
  isDecisionReasonCode,
  redactDecisionPayload,
  speakBlockReasonCode,
  type DecisionEventInput,
} from '../src/decision-events.js';
import { sceneKeyOf } from '../src/session-profile.js';

const T0 = Date.parse('2026-10-27T03:00:00Z');

function input(overrides: Partial<DecisionEventInput> = {}): DecisionEventInput {
  return {
    turnId: 'turn-1',
    instanceId: 'bot-1',
    platform: 'icqq',
    sceneId: sceneKeyOf('group', '123'),
    userId: 'u1',
    kind: 'speak_gate',
    outcome: 'deny',
    reasonCode: 'cannot_speak_muted',
    actor: 'policy',
    ...overrides,
  };
}

describe('ai_decision_events schema', () => {
  it('matches the ADR 0036 column list exactly', () => {
    expect(Object.keys(AI_DECISION_EVENT_MODEL)).toEqual([
      'id', 'ts', 'turn_id', 'instance_id', 'platform', 'scene_id', 'user_id',
      'kind', 'outcome', 'reason_code', 'reason_detail', 'payload', 'actor', 'actor_id',
    ]);
    expect(AI_DECISION_EVENT_MODEL.id).toMatchObject({ type: 'text', primary: true });
    expect(AI_DECISION_EVENT_MODEL.ts.type).toBe('bigint');
    for (const nullable of ['user_id', 'reason_detail', 'actor_id'] as const) {
      expect(AI_DECISION_EVENT_MODEL[nullable].nullable).toBe(true);
    }
  });

  it('pins the minimal kind / outcome / actor sets', () => {
    expect(DECISION_EVENT_KINDS).toEqual([
      'inbound_wake', 'speak_gate', 'control_gate', 'ambient_decision', 'model_skip', 'model_run',
      'tool_call', 'tool_hard_gate', 'tool_approval', 'outbound', 'config_change', 'control_change',
      'member_lifecycle', 'announcement', 'ops_cooldown', 'schedule', 'self_change',
    ]);
    expect(DECISION_OUTCOMES).toEqual(['allow', 'deny', 'skip', 'defer', 'error']);
    expect(DECISION_ACTORS).toEqual(['system', 'model', 'operator', 'policy']);
  });
});

describe('reason_code registry', () => {
  // 只能追加：新增码时在末尾补上；任何删除或重命名都会让这里失败。
  const PINNED = [
    'unknown',
    'cannot_speak_muted',
    'cannot_speak_muted_all',
    'cannot_speak_restricted',
    'control_emergency_stop',
    'control_muted_instance',
    'control_muted_session',
    'control_read_only',
    'control_mention_only',
    'ambient_not_engaged',
    'scene_event_nothing_new',
    'tool_dangerous_no_approval',
    'tool_approval_timeout',
    'tool_approval_denied',
  ];

  it('never drops or renames an existing code', () => {
    expect(DECISION_REASON_CODES.slice(0, PINNED.length)).toEqual(PINNED);
  });

  it('uses unique lower snake_case codes', () => {
    expect(new Set(DECISION_REASON_CODES).size).toBe(DECISION_REASON_CODES.length);
    for (const code of DECISION_REASON_CODES) expect(code).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
  });

  it('appends the ADR 0037 slice A member lifecycle codes after the phase 0 codes', () => {
    const slice = ['welcome_sent', 'welcome_merged', 'welcome_rate_limited', 'welcome_disabled', 'member_leave_recorded'];
    const start = DECISION_REASON_CODES.indexOf('welcome_sent');
    expect(start).toBeGreaterThan(DECISION_REASON_CODES.indexOf('tool_safe_allowed'));
    expect(DECISION_REASON_CODES.slice(start, start + slice.length)).toEqual(slice);
  });

  it('appends the ADR 0037 slice B announcement codes after the slice A codes', () => {
    const slice = [
      'announcement_drafted', 'announcement_submitted', 'announcement_approved', 'announcement_rejected',
      'announcement_expired', 'announcement_sent', 'announcement_send_failed', 'announcement_resend',
      'announcement_hash_mismatch',
    ];
    const start = DECISION_REASON_CODES.indexOf('announcement_drafted');
    expect(start).toBeGreaterThan(DECISION_REASON_CODES.indexOf('member_leave_recorded'));
    expect(DECISION_REASON_CODES.slice(start, start + slice.length)).toEqual(slice);
  });

  it('appends the ADR 0037 slice E ops cooldown codes after the slice B codes', () => {
    const slice = ['ops_cooldown_hit', 'ops_cooldown_passed'];
    const start = DECISION_REASON_CODES.indexOf('ops_cooldown_hit');
    expect(start).toBeGreaterThan(DECISION_REASON_CODES.indexOf('announcement_hash_mismatch'));
    expect(DECISION_REASON_CODES.slice(start, start + slice.length)).toEqual(slice);
  });

  it('appends the ADR 0037 slice C cold-field codes after the slice E codes (kinds are reused)', () => {
    const slice = ['cold_field_mention_only_on', 'cold_field_mention_only_expired', 'cold_field_mention_only_cleared'];
    const start = DECISION_REASON_CODES.indexOf('cold_field_mention_only_on');
    expect(start).toBeGreaterThan(DECISION_REASON_CODES.indexOf('ops_cooldown_passed'));
    expect(DECISION_REASON_CODES.slice(start, start + slice.length)).toEqual(slice);
  });

  it('appends the ADR 0037 slice D schedule codes after the slice C codes', () => {
    const slice = [
      'schedule_event_created', 'schedule_event_updated', 'schedule_event_cancelled',
      'schedule_wake_fired', 'schedule_wake_missed', 'schedule_wake_merged',
    ];
    const start = DECISION_REASON_CODES.indexOf('schedule_event_created');
    expect(start).toBeGreaterThan(DECISION_REASON_CODES.indexOf('cold_field_mention_only_cleared'));
    expect(DECISION_REASON_CODES.slice(start, start + slice.length)).toEqual(slice);
  });

  it('appends the ADR 0038 merge codes after the ADR 0037 slice D codes', () => {
    const slice = [
      'merge_window_joined', 'merge_window_flushed', 'merge_reply_stale_discarded', 'merge_reply_stale_sent',
      'merge_on_behalf_denied', 'danmaku_window_picked', 'hard_gate_scene_pending_cap',
    ];
    const start = DECISION_REASON_CODES.indexOf('merge_window_joined');
    expect(start).toBeGreaterThan(DECISION_REASON_CODES.indexOf('schedule_wake_merged'));
    expect(DECISION_REASON_CODES.slice(start, start + slice.length)).toEqual(slice);
  });

  it('appends the ADR 0040 self-change codes after the ADR 0038 merge codes', () => {
    const slice = [
      'change_drafted', 'change_quota_exceeded', 'change_pruned', 'change_path_forbidden',
      'change_config_key_forbidden', 'change_trial_passed', 'change_trial_failed',
      'change_submitted', 'change_approved', 'change_rejected', 'change_expired', 'change_hash_mismatch',
      'change_applied_none', 'change_applied_reload', 'change_restart_requested', 'change_verified',
      'change_rolled_back', 'change_failed_emergency_stop', 'change_report_sent', 'change_report_redirected',
    ];
    const start = DECISION_REASON_CODES.indexOf('change_drafted');
    expect(start).toBeGreaterThan(DECISION_REASON_CODES.indexOf('hard_gate_scene_pending_cap'));
    expect(DECISION_REASON_CODES.slice(start, start + slice.length)).toEqual(slice);
    expect(DECISION_REASON_CODES.slice(-slice.length)).toEqual(slice);
  });

  it('keeps deprecated codes parseable', () => {
    for (const code of DEPRECATED_DECISION_REASON_CODES) expect(isDecisionReasonCode(code)).toBe(true);
  });

  it('maps #995 speak block reasons to stable codes', () => {
    expect(speakBlockReasonCode('muted')).toEqual({ code: 'cannot_speak_muted', detail: null });
    expect(speakBlockReasonCode('muted_all')).toEqual({ code: 'cannot_speak_muted_all', detail: null });
    expect(speakBlockReasonCode('restricted:readonly_channel')).toEqual({ code: 'cannot_speak_restricted', detail: 'readonly_channel' });
  });
});

describe('createDecisionEvent', () => {
  it('fills id and ts and keeps scene keys aligned with session profiles', () => {
    const event = createDecisionEvent(input(), T0);
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.ts).toBe(T0);
    expect(event.sceneId).toBe('group:123');
    expect(event.payload).toEqual({});
    expect(event.reasonDetail).toBeNull();
  });

  it('folds unknown reason codes into `unknown` and keeps the raw value in detail', () => {
    const event = createDecisionEvent(input({ reasonCode: 'made_up_code', reasonDetail: 'extra' }), T0);
    expect(event.reasonCode).toBe('unknown');
    expect(event.reasonDetail).toBe('reason_code=made_up_code; extra');
  });

  it('truncates reason_detail to 200 characters', () => {
    const event = createDecisionEvent(input({ reasonDetail: '字'.repeat(500) }), T0);
    expect(Array.from(event.reasonDetail ?? '')).toHaveLength(MAX_REASON_DETAIL_CHARS);
    expect(event.reasonDetail?.endsWith('…')).toBe(true);
    expect(createDecisionEvent(input({ reasonDetail: 'a\nb' }), T0).reasonDetail).toBe('a b');
  });

  it('requires actor_id for operator events', () => {
    expect(() => createDecisionEvent(input({ kind: 'control_change', actor: 'operator', outcome: 'allow' }), T0))
      .toThrow(DecisionEventValidationError);
    const event = createDecisionEvent(input({ kind: 'control_change', actor: 'operator', actorId: 'owner', outcome: 'allow' }), T0);
    expect(event.actorId).toBe('owner');
  });

  it('rejects values outside the enums and missing keys', () => {
    expect(() => createDecisionEvent(input({ kind: 'nope' as never }), T0)).toThrow(/kind/);
    expect(() => createDecisionEvent(input({ outcome: 'maybe' as never }), T0)).toThrow(/outcome/);
    expect(() => createDecisionEvent(input({ actor: 'user' as never }), T0)).toThrow(/actor/);
    expect(() => createDecisionEvent(input({ turnId: '' }), T0)).toThrow(/turn_id/);
    expect(() => createDecisionEvent(input({ sceneId: ' ' }), T0)).toThrow(/scene_id/);
  });

  it('allows system events without a user', () => {
    const event = createDecisionEvent(input({ userId: undefined, actor: 'system', kind: 'inbound_wake', outcome: 'defer', reasonCode: 'unknown' }), T0);
    expect(event.userId).toBeNull();
  });
});

describe('payload redaction', () => {
  it('drops secrets, cookies, tokens and full prompts', () => {
    const payload = redactDecisionPayload({
      model: 'gpt',
      apiKey: 'sk-abcdefghijklmnop',
      headers: { Authorization: 'Bearer abcdefghijk', cookie: 'SESSDATA=xyz' },
      access_token: 'x',
      systemPrompt: 'You are...',
      prompt: 'full prompt',
      note: 'used key sk-abcdefghijklmnop and ghp_abcdefghijklmn plus Bearer abcdefghijkl',
      nested: { list: [{ password: 'p' }, 1, true, null] },
    });
    expect(payload).toEqual({
      model: 'gpt',
      apiKey: '[redacted]',
      headers: { Authorization: '[redacted]', cookie: '[redacted]' },
      access_token: '[redacted]',
      systemPrompt: '[omitted]',
      prompt: '[omitted]',
      note: 'used key [redacted] and [redacted] plus Bearer [redacted]',
      nested: { list: [{ password: '[redacted]' }, 1, true, null] },
    });
  });

  it('bounds depth, string length and non-JSON values', () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    expect(JSON.stringify(redactDecisionPayload(deep))).toContain('[max depth]');
    const long = redactDecisionPayload({ text: 'x'.repeat(2_000) }).text as string;
    expect(long.length).toBeLessThan(600);
    expect(redactDecisionPayload({ n: Number.NaN, big: 10n, f: () => 1 })).toEqual({ n: null, big: '10', f: null });
    expect(redactDecisionPayload(null)).toEqual({});
  });
});

describe('row serialization', () => {
  it('round-trips through database rows', () => {
    const event = createDecisionEvent(input({
      kind: 'model_run', outcome: 'allow', reasonCode: 'unknown', reasonDetail: 'ok',
      payload: { model: 'm', durationMs: 120, spoke: true },
    }), T0);
    const row = decisionEventToRow(event);
    expect(row).toMatchObject({ turn_id: 'turn-1', scene_id: 'group:123', reason_code: 'unknown', actor_id: null });
    expect(typeof row.payload).toBe('string');
    expect(decisionEventFromRow(row)).toEqual(event);
  });

  it('accepts dialect-parsed JSON payloads and tolerates broken ones', () => {
    const row = decisionEventToRow(createDecisionEvent(input({ payload: { a: 1 } }), T0));
    expect(decisionEventFromRow({ ...row, payload: { a: 1 } }).payload).toEqual({ a: 1 });
    expect(decisionEventFromRow({ ...row, payload: '{broken' }).payload).toEqual({});
  });

  it('reads codes no longer in the registry as `unknown` without losing the row', () => {
    const row = decisionEventToRow(createDecisionEvent(input(), T0));
    const read = decisionEventFromRow({ ...row, reason_code: 'retired_code', reason_detail: null });
    expect(read.reasonCode).toBe('unknown');
    expect(read.reasonDetail).toBe('reason_code=retired_code');
  });

  it('caps serialized payload size', () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 'v'.repeat(400)]));
    const row = decisionEventToRow(createDecisionEvent(input({ payload: many }), T0));
    expect(row.payload.length).toBeLessThanOrEqual(MAX_DECISION_PAYLOAD_CHARS);
    expect(JSON.parse(row.payload)).toMatchObject({ truncated: true });
  });

  it('exports snake_case fields identical to the table with an object payload', () => {
    const event = createDecisionEvent(input({ payload: { a: 1 } }), T0);
    const exported = decisionEventToExport(event);
    expect(Object.keys(exported)).toEqual(Object.keys(AI_DECISION_EVENT_MODEL));
    expect(exported.payload).toEqual({ a: 1 });
  });
});
