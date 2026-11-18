import { describe, expect, it, vi } from 'vitest';
import {
  AMBIENT_FEATURE_ID,
  inboundOutcomeSink,
  resolveAmbientSwitchAt,
  InboundOutcomeLedger,
  MESSAGE_OUTCOMES,
  MESSAGE_OUTCOME_PLACEHOLDERS,
  MESSAGE_OUTCOME_TEMPLATES,
  Message,
  MessageOutcomeLog,
  defaultOutcomeReply,
  defaultOutcomeVisibility,
  formatMessageOutcome,
  messageOutcomePriority,
  reportInboundOutcome,
  type MessageOutcome,
  type MessageOutcomeRecord,
  type MessageOutcomeReply,
  type MessageOutcomeVisibility,
} from '../../src/plugin-runtime/im/index.js';
import { RuntimeInteractiveRouter } from '../../src/plugin-runtime/im/interactive-router.js';
import { RuntimeInteractionCoordinator } from '../../src/plugin-runtime/im/interaction-runtime.js';

const conversation = { endpoint: { adapter: 'test', id: 'main' }, kind: 'group' as const, id: 'room' };

interface OutcomeFixture { readonly visibility: MessageOutcomeVisibility; readonly reply: MessageOutcomeReply }

/** ADR 0061 §4.3: one fixture per code; a new code without a fixture fails to compile. */
const FIXTURES = {
  replied: { visibility: 'sender', reply: 'yes' },
  command_replied: { visibility: 'sender', reply: 'yes' },
  handler_replied: { visibility: 'sender', reply: 'yes' },
  interaction_answered: { visibility: 'sender', reply: 'yes' },
  suggested: { visibility: 'sender', reply: 'yes' },
  refused: { visibility: 'sender', reply: 'yes' },
  invalid_input: { visibility: 'sender', reply: 'yes' },
  permission_denied: { visibility: 'sender', reply: 'yes' },
  rate_limited: { visibility: 'sender', reply: 'yes' },
  approval_denied: { visibility: 'sender', reply: 'yes' },
  approval_timeout: { visibility: 'sender', reply: 'yes' },
  approval_unavailable: { visibility: 'sender', reply: 'yes' },
  tool_failed_reported: { visibility: 'sender', reply: 'yes' },
  model_timeout: { visibility: 'sender', reply: 'yes' },
  model_error: { visibility: 'sender', reply: 'yes' },
  budget_exhausted: { visibility: 'sender', reply: 'yes' },
  interaction_timeout: { visibility: 'sender', reply: 'yes' },
  interaction_cancelled: { visibility: 'sender', reply: 'yes' },
  not_addressed: { visibility: 'sender', reply: 'no' },
  feature_disabled: { visibility: 'admin', reply: 'no' },
  ambient_silent: { visibility: 'sender', reply: 'no' },
  model_silent: { visibility: 'sender', reply: 'no' },
  merged: { visibility: 'sender', reply: 'no' },
  superseded: { visibility: 'sender', reply: 'no' },
  cleared: { visibility: 'sender', reply: 'yes' },
  interaction_consumed: { visibility: 'sender', reply: 'no' },
  filtered_by_policy: { visibility: 'sender', reply: 'no' },
  media_rejected: { visibility: 'sender', reply: 'no' },
  ignored_self: { visibility: 'replay', reply: 'no' },
  ignored_bot: { visibility: 'replay', reply: 'no' },
  dropped_duplicate: { visibility: 'replay', reply: 'no' },
  dropped_unready: { visibility: 'replay', reply: 'no' },
  dropped_dedup_error: { visibility: 'replay', reply: 'no' },
  dropped_retired: { visibility: 'replay', reply: 'no' },
  delivery_failed: { visibility: 'sender', reply: 'throttled' },
  internal_error: { visibility: 'sender', reply: 'throttled' },
  unrecorded: { visibility: 'admin', reply: 'no' },
} satisfies Record<MessageOutcome, OutcomeFixture>;

function settle(...candidates: Parameters<InboundOutcomeLedger['report']>[0][]): MessageOutcomeRecord {
  const ledger = new InboundOutcomeLedger({ conversation, senderId: 'alice', messageId: 'm1', receivedAt: 1 });
  for (const candidate of candidates) ledger.report(candidate);
  return ledger.settle();
}

describe('message outcome codes (ADR 0061 §1)', () => {
  it('covers every code with defaults and bilingual sender / admin templates using known placeholders only', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...MESSAGE_OUTCOMES].sort());
    for (const outcome of MESSAGE_OUTCOMES) {
      const fixture = FIXTURES[outcome];
      expect([outcome, defaultOutcomeVisibility(outcome)]).toEqual([outcome, fixture.visibility]);
      expect([outcome, defaultOutcomeReply(outcome)]).toEqual([outcome, fixture.reply]);
      const template = MESSAGE_OUTCOME_TEMPLATES[outcome];
      for (const text of [template.sender['zh-CN'], template.sender.en, template.admin['zh-CN'], template.admin.en]) {
        expect(text.trim()).not.toBe('');
        for (const [, name] of text.matchAll(/\{(\w+)\}/gu)) expect(MESSAGE_OUTCOME_PLACEHOLDERS).toContain(name);
      }
      // Sender templates never carry administrator detail.
      expect(template.sender['zh-CN']).not.toContain('{detail}');
      expect(template.sender.en).not.toContain('{detail}');
    }
  });

  it('orders outcomes by priority: errors > delivery > model > approval > tool > refusals > replies > silent > unrecorded', () => {
    const order: MessageOutcome[] = ['internal_error', 'delivery_failed', 'model_error', 'approval_denied',
      'tool_failed_reported', 'refused', 'replied', 'not_addressed', 'unrecorded'];
    for (let i = 1; i < order.length; i += 1) {
      expect(messageOutcomePriority(order[i - 1]!)).toBeGreaterThan(messageOutcomePriority(order[i]!));
    }
    expect(messageOutcomePriority('media_rejected')).toBeLessThan(messageOutcomePriority('replied'));
  });

  it('renders templates per audience and hides detail / errorId unless asked', () => {
    const record = { outcome: 'internal_error' as const, stage: 'command' as const, errorId: 'err_0123456789ab', detail: 'boom', owner: 'root/x' };
    expect(formatMessageOutcome(record, { audience: 'sender', locale: 'en' })).toBe('Something went wrong; logged as err_0123456789ab.');
    expect(formatMessageOutcome(record, { audience: 'admin', locale: 'en' })).not.toContain('boom');
    expect(formatMessageOutcome(record, { audience: 'admin', locale: 'en', includeDetail: true })).toContain('boom');
  });
});

describe('InboundOutcomeLedger (ADR 0061 §4.1)', () => {
  it('keeps the highest-priority candidate and records the others as facets', () => {
    const record = settle(
      { outcome: 'replied', reason: 'agent', stage: 'model', turnId: 't1' },
      { outcome: 'media_rejected', reason: 'too_large', stage: 'model' },
      { outcome: 'delivery_failed', reason: 'platform_rejected', stage: 'delivery' },
    );
    expect(record).toMatchObject({ outcome: 'delivery_failed', reason: 'platform_rejected', turnId: 't1', reply: 'throttled' });
    expect(record.facets).toEqual(['media_rejected:too_large', 'replied:agent']);
  });

  it('tracks delivered replies per author, and ignores replies after settle (#1250)', () => {
    const ledger = new InboundOutcomeLedger({ conversation, receivedAt: 1 });
    expect(ledger.replied()).toBe(false);
    ledger.noteReplyDelivered('plugin-a');
    expect(ledger.replied()).toBe(true);
    expect(ledger.replied('plugin-a')).toBe(true);
    expect(ledger.replied('plugin-b')).toBe(false);
    ledger.report({ outcome: 'handler_replied', reason: 'middleware_replied', stage: 'middleware' });
    ledger.settle();
    ledger.noteReplyDelivered('plugin-b');
    expect(ledger.replied('plugin-b')).toBe(false);
  });

  it('keeps the earlier candidate on a tie and settles exactly once', () => {
    const ledger = new InboundOutcomeLedger({ conversation, receivedAt: 1 });
    ledger.report({ outcome: 'not_addressed', reason: 'no_command_not_ambient', stage: 'ambient' });
    ledger.report({ outcome: 'not_addressed', reason: 'prefix_mismatch', stage: 'command' });
    const first = ledger.settle();
    expect(first.reason).toBe('no_command_not_ambient');
    expect(ledger.report({ outcome: 'internal_error', stage: 'command' })).toBe(false);
    expect(ledger.settle()).toBe(first);
  });

  it('settles a failure as internal_error with masked, bounded detail, and nothing as unrecorded', () => {
    const ledger = new InboundOutcomeLedger({ conversation, receivedAt: 1 });
    ledger.enter('handlers');
    const failed = ledger.settle({ error: { errorId: 'err_aaaaaaaaaaaa', name: 'Error', message: `Authorization: Bearer abcdefghijkl ${'x'.repeat(400)}` } });
    expect(failed).toMatchObject({ outcome: 'internal_error', reason: 'handler_threw', stage: 'handlers', errorId: 'err_aaaaaaaaaaaa' });
    expect(failed.detail).not.toContain('abcdefghijkl');
    expect([...failed.detail!].length).toBeLessThanOrEqual(200);
    const empty = new InboundOutcomeLedger({ conversation, receivedAt: 1 });
    empty.enter('agent_gate');
    expect(empty.settle()).toMatchObject({ outcome: 'unrecorded', reason: 'missing_outcome', lastStage: 'agent_gate', visibility: 'admin' });
  });

  it('upgrades replay-only drops to sender visibility for addressed messages (§1.5)', () => {
    const ledger = new InboundOutcomeLedger({ conversation, receivedAt: 1, addressed: true });
    ledger.report({ outcome: 'dropped_unready', reason: 'venue_unready', stage: 'ingress' });
    expect(ledger.settle().visibility).toBe('sender');
    expect(settle({ outcome: 'dropped_unready', reason: 'venue_unready', stage: 'ingress' }).visibility).toBe('replay');
  });

  it('accepts reports through the message view and ignores messages without a ledger', () => {
    const ledger = new InboundOutcomeLedger({ conversation, receivedAt: 1 });
    const message = new Message({ conversation, content: 'hi' }, { generation: 1, reply: async () => ({ status: 'sent' }), outcomes: ledger });
    expect(reportInboundOutcome(message, { outcome: 'cleared', reason: 'clear_command', stage: 'agent_gate' })).toBe(true);
    expect(ledger.settle().outcome).toBe('cleared');
    expect(reportInboundOutcome({ conversation }, { outcome: 'cleared', stage: 'agent_gate' })).toBe(false);
  });
});

describe('MessageOutcomeLog (ADR 0061 §2)', () => {
  const record = (index: number, overrides: Partial<MessageOutcomeRecord> = {}): MessageOutcomeRecord => ({
    id: `r${index}`, receivedAt: 60_000 + index, settledAt: 60_000 + index, conversation, platform: 'test', sceneId: 'group:room',
    senderId: 'bob', messageId: `m${index}`, addressed: false, outcome: 'not_addressed', reason: 'no_command_not_ambient', facets: [],
    stage: 'ambient', visibility: 'sender', reply: 'no', ...overrides,
  });

  it('aggregates quiet outcomes beyond the per-minute limit and never samples addressed or loud ones', () => {
    const log = new MessageOutcomeLog({ quietSampleLimit: 3, now: () => 61_000 });
    for (let i = 0; i < 6; i += 1) log.record(record(i));
    log.record(record(10, { addressed: true }));
    log.record(record(11, { outcome: 'command_replied', reason: 'executed' }));
    const rows = log.list({ limit: 100 });
    expect(rows).toHaveLength(6);
    const aggregated = rows.find(row => row.facets.some(facet => facet.startsWith('aggregated:')))!;
    expect(aggregated.facets).toContain('aggregated:3');
    expect(aggregated.messageId).toBeUndefined();
    expect(aggregated.senderId).toBeUndefined();
  });

  it('filters by conversation, sender, outcome and time, newest first, and drops rows after the TTL', () => {
    let now = 61_000;
    const log = new MessageOutcomeLog({ ttlMs: 10_000, now: () => now });
    log.record(record(1));
    log.record(record(2, { outcome: 'command_replied', senderId: 'alice' }));
    expect(log.list({ senderId: 'alice' }).map(row => row.id)).toEqual(['r2']);
    expect(log.list({ outcome: 'not_addressed' }).map(row => row.id)).toEqual(['r1']);
    expect(log.list().map(row => row.id)).toEqual(['r2', 'r1']);
    expect(log.list({ since: 60_002 }).map(row => row.id)).toEqual(['r2']);
    now = 80_000;
    expect(log.list()).toEqual([]);
  });
});

describe('interaction answers (ADR 0061 P5)', () => {
  function message(sender: string, content: string, reply = vi.fn(async () => ({ status: 'sent' as const }))) {
    return new Message({ conversation, content, sender: { id: sender } }, { generation: 1, reply });
  }

  it('only takes the target’s replies by default and classifies unparseable ones as consumed', async () => {
    const interactions = new RuntimeInteractionCoordinator(new RuntimeInteractiveRouter(100));
    const reply = vi.fn(async () => ({ status: 'sent' as const }));
    const abort = new AbortController();
    const answer = interactions.create(message('alice', 'remind', reply)).ask({ type: 'confirm', title: '确认？', signal: abort.signal });
    try {
      await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
      expect(interactions.resolveClaimDetailed(message('bob', '是'))).toBe(false);
      expect(interactions.resolveClaimDetailed(message('alice', '今天吃什么'))).toEqual({ answerLike: false });
      await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(interactions.resolveClaimDetailed(message('alice', '是'))).toEqual({ answerLike: true }));
      await expect(answer).resolves.toBe(true);
    } finally { abort.abort(); }
  });

  it("lets anyone answer with answeredBy: 'anyone'", async () => {
    const interactions = new RuntimeInteractionCoordinator(new RuntimeInteractiveRouter(100));
    const reply = vi.fn(async () => ({ status: 'sent' as const }));
    const abort = new AbortController();
    const answer = interactions.create(message('alice', 'vote', reply)).ask({ type: 'text', title: '谁来？', answeredBy: 'anyone', signal: abort.signal });
    try {
      await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
      expect(interactions.resolveClaim(message('bob', '我来'))).toBe(true);
      await expect(answer).resolves.toBe('我来');
    } finally { abort.abort(); }
  });

  it('re-sends the prompt once after an invalid answer, then reminds at most every 20 s (decision 11, revised)', async () => {
    const interactions = new RuntimeInteractionCoordinator(new RuntimeInteractiveRouter(100));
    const reply = vi.fn(async () => ({ status: 'sent' as const }));
    const abort = new AbortController();
    const answer = interactions.create(message('alice', 'n', reply)).ask({ type: 'number', title: '数量', signal: abort.signal });
    try {
      await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
      for (const text of ['a', 'b', 'c']) {
        await vi.waitFor(() => expect(interactions.resolveClaim(message('alice', text))).toBe(true));
      }
      await vi.waitFor(() => expect(interactions.resolveClaim(message('alice', '3'))).toBe(true));
      await expect(answer).resolves.toBe(3);
      // prompt, re-sent prompt after `a`, one reminder after `b`; `c` came within 20 s.
      expect(reply).toHaveBeenCalledTimes(3);
      expect(reply.mock.calls[2]).toEqual(['正在等你回答，按提示回复，或回复「取消」退出。']);
    } finally { abort.abort(); }
  });
});

describe('group interjection switch (ADR 0062 §23)', () => {
  const rows = new Map<string, { enabled?: false; patch: Record<string, unknown>; revision: number; updatedAt: number }>();
  const reader = { get: (plugin: string, key: string) => (plugin === AMBIENT_FEATURE_ID ? rows.get(key) : undefined) };
  const key = 'qq/bot-1/group:100';

  it('uses the file default without overrides, turns on below it, and lets an off above lock the levels below', () => {
    rows.clear();
    expect(resolveAmbientSwitchAt(reader, key, false)).toEqual({ enabled: false, source: 'global' });
    expect(resolveAmbientSwitchAt(reader, key, true)).toEqual({ enabled: true, source: 'global' });
    rows.set(key, { patch: { engage: true }, revision: 1, updatedAt: 1 });
    expect(resolveAmbientSwitchAt(reader, key, false)).toEqual({ enabled: true, source: 'conversation' });
    rows.set('qq/bot-1', { enabled: false, patch: {}, revision: 1, updatedAt: 1 });
    expect(resolveAmbientSwitchAt(reader, key, true)).toEqual({ enabled: false, source: 'endpoint' });
    expect(resolveAmbientSwitchAt(reader, key, true, 'conversation')).toEqual({ enabled: false, source: 'endpoint', lockedBy: 'endpoint' });
    rows.delete('qq/bot-1');
    rows.set(key, { enabled: false, patch: {}, revision: 2, updatedAt: 2 });
    // "All groups except this one": `*` in the file, off in one conversation.
    expect(resolveAmbientSwitchAt(reader, key, true)).toEqual({ enabled: false, source: 'conversation' });
    expect(resolveAmbientSwitchAt(reader, 'qq/bot-1/group:200', true)).toEqual({ enabled: true, source: 'global' });
  });
});

describe('outcome reports cannot be forged (review of #1281)', () => {
  it('drops unknown codes and framework-only codes reported through the public sink', () => {
    const ledger = new InboundOutcomeLedger({ conversation, receivedAt: 1 });
    const message = new Message({ conversation, content: 'hi' }, { generation: 1, reply: async () => ({ status: 'sent' }), outcomes: ledger });
    expect(reportInboundOutcome(message, { outcome: 'made_up' as never, stage: 'handlers' })).toBe(false);
    expect(reportInboundOutcome(message, { outcome: 'internal_error', reason: 'command_threw', stage: 'command', errorId: 'err_000000000000' })).toBe(false);
    expect(reportInboundOutcome(message, { outcome: 'unrecorded', stage: 'command' })).toBe(false);
    expect(ledger.report({ outcome: 'internal_error', stage: 'command' })).toBe(false);
    expect(reportInboundOutcome(message, { outcome: 'handler_replied', reason: 'handler', stage: 'handlers' })).toBe(true);
    const record = ledger.settle();
    expect(record.outcome).toBe('handler_replied');
    expect(record.facets).toEqual([]);
    // Only the framework settles a failure.
    const failing = new InboundOutcomeLedger({ conversation, receivedAt: 1 });
    expect(failing.settle({ error: { errorId: 'err_aaaaaaaaaaaa', message: 'boom' } }).outcome).toBe('internal_error');
  });
});

describe('MessageOutcomeLog keeps loud outcomes under a silent flood (review of #1281)', () => {
  const row = (index: number, outcome: MessageOutcome, sender = `u${index}`): MessageOutcomeRecord => ({
    id: `f${index}`, receivedAt: 60_000 + index, settledAt: 60_000 + index,
    conversation: { ...conversation, id: `room-${index % 50}` }, platform: 'test', sceneId: 'group:room', senderId: sender,
    addressed: false, outcome, facets: [], stage: 'ambient', visibility: 'sender', reply: 'no',
  });

  it('evicts silent rows first, so an internal_error survives thousands of not_addressed rows', () => {
    const log = new MessageOutcomeLog({ capacity: 100, now: () => 61_000 });
    log.record(row(0, 'internal_error'));
    log.record(row(1, 'command_replied'));
    for (let index = 2; index < 5_000; index += 1) log.record(row(index, 'not_addressed'));
    const rows = log.list({ limit: 500 });
    expect(rows.length).toBeLessThanOrEqual(100);
    expect(log.get('f0')?.outcome).toBe('internal_error');
    expect(log.get('f1')?.outcome).toBe('command_replied');
    expect(log.list({ outcome: 'internal_error' })).toHaveLength(1);
  });

  it('falls back to the oldest row once only loud rows remain', () => {
    const log = new MessageOutcomeLog({ capacity: 3, now: () => 61_000 });
    for (let index = 0; index < 5; index += 1) log.record(row(index, 'delivery_failed'));
    expect(log.list({ limit: 10 }).map(record => record.id)).toEqual(['f4', 'f3', 'f2']);
  });
});

describe('unrecorded listeners (review of #1281)', () => {
  it('share one process-wide set even when the module is loaded twice', async () => {
    vi.resetModules();
    const copy = await import('../../src/plugin-runtime/im/inbound-outcome-ledger.js');
    expect(copy.InboundOutcomeLedger).not.toBe(InboundOutcomeLedger);
    const seen: string[] = [];
    const stop = copy.onUnrecordedInboundOutcome(record => { seen.push(String(record.lastStage)); });
    try {
      const ledger = new InboundOutcomeLedger({ conversation, receivedAt: 1 });
      ledger.enter('agent_gate');
      ledger.settle();
      expect(seen).toEqual(['agent_gate']);
    } finally { stop(); }
  });
});

describe('message views only expose the report port (review of #1281)', () => {
  it('returns a frozen { report, enter } facade; a cast settle cannot change the outcome', () => {
    const ledger = new InboundOutcomeLedger({ conversation, receivedAt: 1 });
    const message = new Message({ conversation, content: 'hi' }, { generation: 1, reply: async () => ({ status: 'sent' }), outcomes: ledger });
    const port = (message as unknown as Record<symbol, () => unknown>)[inboundOutcomeSink]!() as Record<string, unknown>;
    expect(port).not.toBe(ledger);
    expect(Object.isFrozen(port)).toBe(true);
    expect(Object.keys(port).sort()).toEqual(['enter', 'replied', 'report']);
    expect(typeof (port as { settle?: unknown }).settle).toBe('undefined');
    expect(() => (port as unknown as InboundOutcomeLedger).settle()).toThrow(TypeError);
    reportInboundOutcome(message, { outcome: 'command_replied', reason: 'executed', stage: 'command' });
    expect(ledger.settle().outcome).toBe('command_replied');
  });
});
