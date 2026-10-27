import { describe, expect, it, vi } from 'vitest';
import { DecisionEventLog, SessionProfileStore } from '@zhin.js/agent';
import { MemoryConversationEventStore, type ConversationEvent } from '@zhin.js/im-contract';
import {
  auditCannotSpeak,
  auditModelRun,
  auditOutbound,
  createDecisionAudit,
  decisionScopeOf,
} from '../../../../src/plugin-runtime/agent/turn/decision-audit.js';
import { auditAmbientDecision } from '../../../../src/plugin-runtime/agent/turn/ingress-route.js';
import { SceneEventIngress } from '../../../../src/plugin-runtime/agent/turn/scene-event-ingress.js';

const scope = decisionScopeOf({ turnId: 't1', platform: 'icqq', scope: 'group', sceneId: 'g1', endpoint: '10000', userId: 'u1' });

function audited() {
  const log = new DecisionEventLog();
  return { log, audit: createDecisionAudit(log, scope) };
}

const rows = (log: DecisionEventLog) => log.recent().map((r) => [r.kind, r.outcome, r.reasonCode, r.reasonDetail]);

describe('decision audit write path', () => {
  it('scopes rows like the session profile: <scope>:<sceneId>, endpoint as instance', () => {
    expect(scope).toEqual({ turnId: 't1', instanceId: '10000', platform: 'icqq', sceneId: 'group:g1', userId: 'u1' });
  });

  it('#995 cannot speak → speak_gate deny + model_skip with stable cannot_speak_* codes', async () => {
    const { log, audit } = audited();
    auditCannotSpeak(audit, 'muted', { source: 'message' });
    auditCannotSpeak(audit, 'restricted:host', { source: 'message' });
    await log.idle();
    expect(rows(log)).toEqual([
      ['speak_gate', 'deny', 'cannot_speak_muted', null],
      ['model_skip', 'skip', 'cannot_speak_muted', null],
      ['speak_gate', 'deny', 'cannot_speak_restricted', 'host'],
      ['model_skip', 'skip', 'cannot_speak_restricted', 'host'],
    ]);
    expect(log.recent()[0]!.actor).toBe('policy');
  });

  it('ambient: engage → allow; declined / skipped → ambient_not_engaged + model_skip; superseded → nothing', async () => {
    const { log, audit } = audited();
    auditAmbientDecision(audit, { kind: 'engage', judgment: { engage: true, confidence: 0.9, reason: 'quote of chat' } });
    auditAmbientDecision(audit, { kind: 'declined', judgment: { engage: false, confidence: 0.2, reason: 'quote of chat' } });
    auditAmbientDecision(audit, { kind: 'skipped', reason: 'cooldown' });
    auditAmbientDecision(audit, { kind: 'skipped', reason: 'superseded' });
    expect(rows(log)).toEqual([
      ['ambient_decision', 'allow', 'ambient_engaged', null],
      ['ambient_decision', 'skip', 'ambient_not_engaged', 'declined'],
      ['model_skip', 'skip', 'ambient_not_engaged', 'declined'],
      ['ambient_decision', 'skip', 'ambient_not_engaged', 'cooldown'],
      ['model_skip', 'skip', 'ambient_not_engaged', 'cooldown'],
    ]);
    // 判定理由可能转述群聊，不入审计。
    expect(JSON.stringify(log.recent())).not.toContain('quote of chat');
  });

  it('model_run and outbound summaries', () => {
    const { log, audit } = audited();
    auditModelRun(audit, { status: 'completed', output: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } } as never, { model: 'm' });
    auditModelRun(audit, { status: 'failed', error: { code: 'timeout', message: 'x', retryable: true }, usage: {} } as never);
    auditOutbound(audit, { status: 'sent', messageId: 'm1' });
    auditOutbound(audit, { status: 'suppressed' });
    auditOutbound(audit, { status: 'failed', code: 'rate_limited', retryable: true });
    expect(rows(log)).toEqual([
      ['model_run', 'allow', 'model_completed', null],
      ['model_run', 'error', 'model_failed', 'timeout'],
      ['outbound', 'allow', 'outbound_sent', null],
      ['outbound', 'skip', 'outbound_suppressed', null],
      ['outbound', 'error', 'outbound_failed', 'failed:rate_limited'],
    ]);
    expect(log.recent()[0]!.payload).toMatchObject({ model: 'm', status: 'completed', inputTokens: 10, outputTokens: 2 });
  });

  it('never blocks the turn when the writer throws', () => {
    const writer = { record: () => { throw new Error('boom'); } } as unknown as DecisionEventLog;
    const audit = createDecisionAudit(writer, scope);
    expect(() => auditCannotSpeak(audit, 'muted')).not.toThrow();
    const rejecting = { record: () => Promise.reject(new Error('db down')) } as unknown as DecisionEventLog;
    expect(() => createDecisionAudit(rejecting, scope)({ kind: 'outbound', outcome: 'allow', reasonCode: 'outbound_sent' })).not.toThrow();
  });

  it('is a no-op without a writer', () => {
    expect(() => createDecisionAudit(undefined, scope)({ kind: 'outbound', outcome: 'allow', reasonCode: 'outbound_sent' })).not.toThrow();
  });
});

// ── #997 scene event wake ───────────────────────────────────────────────────

const endpoint = Object.freeze({ id: 'icqq', adapter: 'icqq' });
const group = Object.freeze({ endpoint, kind: 'group' as const, id: 'g1' });
let seq = 0;
function ev(type: string, extra: Record<string, unknown>): ConversationEvent {
  seq += 1;
  return { eventId: `d${seq}`, conversation: group, timestamp: Date.now(), type, ...extra } as unknown as ConversationEvent;
}

function harness(sessions?: SessionProfileStore) {
  let timers: { run: () => void }[] = [];
  const store = new MemoryConversationEventStore();
  const log = new DecisionEventLog();
  const executeTurn = vi.fn(async (request: any) => {
    await request.ports.reply.send([{ type: 'message', segments: [{ type: 'text', data: { text: 'hi' } }] }]);
    return { status: 'completed' as const, output: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  });
  const ingress = new SceneEventIngress({
    projectRoot: '/tmp/project',
    triggerConfig: () => ({ sceneEvents: { conversations: ['icqq:g1'] } }),
    reader: () => store,
    sessions: () => sessions,
    decisionEvents: () => log,
    deliver: async () => ({ status: 'sent' as const }),
    executeTurn: executeTurn as never,
    timeoutMs: () => 10_000,
    setTimer: (run) => { timers.push({ run }); return timers.length; },
    clearTimer: () => {},
  });
  const emit = async (event: ConversationEvent) => {
    const { sequence } = await store.append(event);
    return ingress.handle({ sequence, event, selfIds: ['10000'], endpointId: '10000' });
  };
  const flush = async () => {
    const due = timers; timers = [];
    for (const timer of due) timer.run();
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await log.idle();
  };
  return { ingress, log, emit, flush, executeTurn };
}

describe('scene event wake audit (#997)', () => {
  it('cannot speak → speak_gate + model_skip, same codes as session-gate; model not called', async () => {
    const { log, emit, flush, executeTurn } = harness(new SessionProfileStore());
    await emit(ev('member.muted', { member: { id: '10000' }, actor: { id: 'admin' }, durationSeconds: 600 }));
    await flush();
    expect(executeTurn).not.toHaveBeenCalled();
    expect(rows(log)).toEqual([
      ['speak_gate', 'deny', 'cannot_speak_muted', null],
      ['model_skip', 'skip', 'cannot_speak_muted', null],
    ]);
    const [gate, skip] = log.recent();
    expect(gate!.turnId).toBe(skip!.turnId);
    expect(gate!).toMatchObject({ platform: 'icqq', sceneId: 'group:g1', instanceId: '10000' });
    expect(gate!.payload).toMatchObject({ source: 'scene_event', events: 1, types: 'member.muted' });
  });

  it('woken turn → inbound_wake allow, outbound, model_run on one turn_id matching the request', async () => {
    const { log, emit, flush, executeTurn } = harness();
    await emit(ev('member.joined', { member: { id: 'u1' } }));
    await flush();
    expect(executeTurn).toHaveBeenCalledTimes(1);
    expect(rows(log)).toEqual([
      ['inbound_wake', 'allow', 'scene_event_high_priority', null],
      ['outbound', 'allow', 'outbound_sent', null],
      ['model_run', 'allow', 'model_completed', null],
    ]);
    const turnId = (executeTurn.mock.calls[0]![0] as any).identity.turnId;
    expect(new Set(log.recent().map((r) => r.turnId))).toEqual(new Set([turnId]));
    expect(log.recent()[2]!.payload).toMatchObject({ source: 'scene_event', spoke: true, status: 'completed' });
  });

  it('nothing new → model_skip / scene_event_nothing_new', async () => {
    const { ingress, log, emit, flush } = harness();
    await emit(ev('member.joined', { member: { id: 'u1' } }));
    await flush();
    const before = log.recent().length;
    const result = await ingress.wakeScene({
      key: 'icqq:g1', conversation: group, throughSequence: 1,
      items: [{ sequence: 1, event: ev('member.joined', { member: { id: 'u1' } }), selfIds: ['10000'], endpointId: '10000' }],
    });
    await log.idle();
    expect(result).toEqual({ kind: 'skipped', reason: 'nothing_new' });
    expect(rows(log).slice(before)).toEqual([['model_skip', 'skip', 'scene_event_nothing_new', null]]);
  });
});
