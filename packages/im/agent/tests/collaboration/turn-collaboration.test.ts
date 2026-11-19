/**
 * #1250 batch 26: one conclusion per request. Unit tests of the per-engagement outcome ledger that decides
 * whether delegated results wake the entry actor, stay in the trace, or get one fixed line, and when a
 * guard stop must be told.
 */
import type { Mail } from '@zhin.js/harness';
import {
  NO_REPLY_MARKER, asSupplement, createEngagementOutcomes, isNoReply, planSupplement, stripNoReplyMarker, stripNoReplyOutput, stripNoReplySnapshot, streamTextWithoutNoReply, supplementFailureLine, supplementPreface,
} from '../../src/collaboration/turn-collaboration.js';

type Status = 'completed' | 'failed' | 'cancelled' | 'budget_exceeded' | 'denied';

function request(id: string, from: string, to: string, kind: 'ask' | 'delegate', causationId?: string): Mail {
  return {
    id, kind, to, engagementId: 'e1', grantId: 'g', createdAt: 0,
    from: { kind: 'actor', actor: from },
    ...(causationId ? { causationId } : {}),
    body: kind === 'ask' ? { kind: 'ask', question: 'q' } : { kind: 'delegate', brief: 'b' },
  } as unknown as Mail;
}

function result(inReplyTo: string, from: string, status: Status): Mail {
  return {
    id: `r-${inReplyTo}`, kind: 'result', to: 'zhin', engagementId: 'e1', grantId: 'g', createdAt: 0,
    from: { kind: 'actor', actor: from }, causationId: inReplyTo,
    body: { kind: 'result', inReplyTo, status, content: '' },
  } as unknown as Mail;
}

describe('engagement outcomes: delegated results', () => {
  it('runs a batch that carries any completed result', () => {
    const outcomes = createEngagementOutcomes();
    outcomes.failuresTold([result('m0', 'draw', 'failed')]);
    expect(outcomes.plan([result('m1', 'draw', 'completed'), result('m2', 'draw', 'failed')])).toEqual({ kind: 'run' });
  });

  it('lets the first failure of a request wake the entry actor', () => {
    const outcomes = createEngagementOutcomes();
    expect(outcomes.plan([result('m3', 'draw', 'budget_exceeded')])).toEqual({ kind: 'run' });
  });

  it('withholds a failure that a completed follow-up on the same delegation superseded', () => {
    const outcomes = createEngagementOutcomes();
    outcomes.recordSubTurn([request('m3', 'zhin', 'draw', 'delegate', 'm1')], 'budget_exceeded');
    outcomes.recordSubTurn([request('m5', 'zhin', 'draw', 'ask', 'm3')], 'completed');
    expect(outcomes.plan([result('m3', 'draw', 'budget_exceeded')])).toEqual({ kind: 'withhold', reason: 'superseded' });
  });

  it('follows a chain of follow-ups back to the delegation', () => {
    const outcomes = createEngagementOutcomes();
    outcomes.recordSubTurn([request('m3', 'zhin', 'draw', 'delegate', 'm1')], 'budget_exceeded');
    outcomes.recordSubTurn([request('m5', 'zhin', 'draw', 'ask', 'm3')], 'failed');
    outcomes.recordSubTurn([request('m7', 'zhin', 'draw', 'ask', 'm5')], 'completed');
    expect(outcomes.plan([result('m3', 'draw', 'failed')])).toEqual({ kind: 'withhold', reason: 'superseded' });
  });

  it('does not count a later, separate ask or delegate to the same agent as superseding', () => {
    const outcomes = createEngagementOutcomes();
    outcomes.recordSubTurn([request('m3', 'zhin', 'draw', 'delegate', 'm1')], 'budget_exceeded');
    // A new delegation (causation: the root mail) and a new ask, both completed.
    outcomes.recordSubTurn([request('m4', 'zhin', 'draw', 'delegate', 'm1')], 'completed');
    outcomes.recordSubTurn([request('m6', 'zhin', 'draw', 'ask', 'm1')], 'completed');
    expect(outcomes.plan([result('m3', 'draw', 'budget_exceeded')])).toEqual({ kind: 'run' });
  });

  it('does not treat a sub-agent\'s own ask as a follow-up of the mail it was processing', () => {
    const outcomes = createEngagementOutcomes();
    outcomes.recordSubTurn([request('m3', 'zhin', 'alice', 'delegate', 'm1')], 'failed');
    // alice asked bob while processing m3: causation m3, but a different sender and target.
    outcomes.recordSubTurn([request('m4', 'alice', 'bob', 'ask', 'm3')], 'completed');
    expect(outcomes.plan([result('m3', 'alice', 'failed')])).toEqual({ kind: 'run' });
  });

  it('gives a later, different failure one fixed line instead of waking the entry actor again', () => {
    const outcomes = createEngagementOutcomes();
    outcomes.failuresTold([result('m3', 'draw', 'budget_exceeded')]);
    expect(outcomes.plan([result('m4', 'draw', 'budget_exceeded'), result('m5', 'draw', 'failed')]))
      .toEqual({ kind: 'line', reason: 'another_failure', count: 2 });
    // Each delegation's failure is told once.
    expect(outcomes.plan([result('m4', 'draw', 'cancelled')])).toEqual({ kind: 'withhold', reason: 'superseded' });
  });

  it('does not count a failure as told until something was delivered', () => {
    const outcomes = createEngagementOutcomes();
    // The first failure-only batch ran, but its delivery failed: nothing was marked.
    expect(outcomes.plan([result('m3', 'draw', 'failed')])).toEqual({ kind: 'run' });
    expect(outcomes.plan([result('m4', 'draw', 'failed')])).toEqual({ kind: 'run' });
  });

  it('withholds failures after the guard stopped the request', () => {
    const outcomes = createEngagementOutcomes();
    outcomes.entryStarted();
    outcomes.entryInformed();
    expect(outcomes.stopped()).toBe(false);
    expect(outcomes.entryFinished()).toBe(false);
    expect(outcomes.plan([result('m3', 'alice', 'cancelled')])).toEqual({ kind: 'withhold', reason: 'collaboration_stopped' });
  });
});

describe('engagement outcomes: guard stops', () => {
  it('tells a stop at once when no entry turn runs', () => {
    const outcomes = createEngagementOutcomes();
    expect(outcomes.stopped()).toBe(true);
    outcomes.stopAnnounced();
    expect(outcomes.stopped()).toBe(false);
  });

  it('defers a stop the running entry turn never saw to the end of that turn (B1)', () => {
    const outcomes = createEngagementOutcomes();
    outcomes.entryStarted();
    expect(outcomes.stopped()).toBe(false);
    expect(outcomes.entryFinished()).toBe(true);
    outcomes.stopAnnounced();
    outcomes.entryStarted();
    expect(outcomes.entryFinished()).toBe(false);
  });

  it('says nothing more when the entry model met the stop itself', () => {
    const outcomes = createEngagementOutcomes();
    outcomes.entryStarted();
    outcomes.stopped();
    outcomes.entryInformed();
    expect(outcomes.entryFinished()).toBe(false);
  });

  it('counts the stop line as the request\'s failure account', () => {
    const outcomes = createEngagementOutcomes();
    expect(outcomes.stopped()).toBe(true);
    outcomes.stopAnnounced();
    expect(outcomes.plan([result('m3', 'alice', 'cancelled')])).toEqual({ kind: 'withhold', reason: 'collaboration_stopped' });
  });
});

describe('engagement outcomes: a result after the request was answered (#1250 delegate-result-double-reply)', () => {
  it('remembers what the human was told for the request', () => {
    const outcomes = createEngagementOutcomes();
    expect(outcomes.answered()).toBeUndefined();
    outcomes.replied('  ');
    expect(outcomes.answered()).toBeUndefined();
    outcomes.replied('这是一只橘猫。');
    outcomes.replied('补充：它戴着铃铛。');
    expect(outcomes.answered()).toBe('这是一只橘猫。\n补充：它戴着铃铛。');
  });

  it('shows the entry model its earlier reply and the structured no-reply exit', () => {
    const preface = supplementPreface('这是一只橘猫。');
    // The earlier reply is data, not instructions (it may quote what the human wrote).
    expect(preface).toContain('[external_content source="earlier_reply"');
    expect(preface).toContain('这是一只橘猫。\n[end external_content]');
    expect(preface).toContain(NO_REPLY_MARKER);
    expect(preface).toMatch(/Do not repeat or restate/);
    expect(supplementPreface('x'.repeat(5_000)).length).toBeLessThan(2_000);
  });

  it('offers no no-reply exit for a failure batch (#1250)', () => {
    const preface = supplementPreface('这是一只橘猫。', { failure: true });
    expect(preface).not.toContain(NO_REPLY_MARKER);
    expect(preface).toMatch(/did not finish\. Tell the human/);
  });

  it('recognises the marker with spaces, backticks or another case, and strips it from any output', () => {
    for (const reply of ['`[[no_reply]]`', ' [[NO_REPLY]] ', '```\n[[ No_Reply ]]\n```']) {
      expect(isNoReply(reply)).toBe(true);
      expect(asSupplement({ status: 'completed', content: '', reply }, 'zh-CN')).toBeUndefined();
    }
    expect(stripNoReplyMarker('这是一只橘猫。`[[No_Reply]]`')).toBe('这是一只橘猫。');
    expect(stripNoReplyOutput([{ type: 'text', content: '这是一只橘猫。 [[no_reply]]' }, { type: 'text', content: '`[[no_reply]]`' }]))
      .toEqual([{ type: 'text', content: '这是一只橘猫。' }]);
    expect(supplementFailureLine('zh-CN')).toBe('补充：后台任务没有完成。');
    expect(supplementFailureLine('en-US')).toBe('Update: the background task did not finish.');
  });

  it('filters the marker out of a streamed snapshot without rewriting what may already be shown (#1250 第 56 批)', () => {
    const part = (key: string, value: Record<string, unknown>, complete = true) => ({ key, complete, value: value as never });
    const snapshot = { revision: 3, messages: [
      { key: 'm0', complete: true, segments: [part('s0', { type: 'text', data: { text: '答案 [[no_reply]]' } }), part('s1', { type: 'image', data: { url: 'x' } })] },
      { key: 'm1', complete: true, segments: [part('s0', { type: 'markdown', data: { content: '`[[NO_REPLY]]`' } })] },
    ] };
    // Never trimmed: what an update published stays a prefix of the finish.
    expect(stripNoReplySnapshot(snapshot)).toEqual({ revision: 3, messages: [
      { key: 'm0', complete: true, segments: [part('s0', { type: 'text', data: { text: '答案 ' } }), part('s1', { type: 'image', data: { url: 'x' } })] },
    ] });
    const clean = { revision: 1, messages: [{ key: 'm0', complete: true, segments: [part('s0', { type: 'text', data: { text: '答案' } })] }] };
    expect(stripNoReplySnapshot(clean)).toBe(clean);
    // A growing part holds back a tail that may still become the marker, in any spelling.
    for (const tail of ['`', '``[', '[', '[[', '[[ No_', '[[no_reply', '[[no_reply ]']) {
      expect(streamTextWithoutNoReply(`答案 ${tail}`, false)).toBe('答案 ');
      expect(streamTextWithoutNoReply(`答案 ${tail}`, true)).toBe(`答案 ${tail}`);
    }
    expect(streamTextWithoutNoReply('答案 [[note]]', false)).toBe('答案 [[note]]');
    expect(streamTextWithoutNoReply('`code` 后', false)).toBe('`code` 后');
    // Each shown text is a prefix of the next one while the reply grows.
    const full = '这是一只橘猫。 `[[No_Reply]]` 以上';
    let shown = '';
    for (let end = 1; end <= full.length; end += 1) {
      const next = streamTextWithoutNoReply(full.slice(0, end), false);
      expect(next.startsWith(shown)).toBe(true);
      expect(next).not.toMatch(/no_re/iu);
      shown = next;
    }
    expect(streamTextWithoutNoReply(full, true)).toBe('这是一只橘猫。  以上');
  });

  it('sends nothing when the model declines or says nothing', () => {
    expect(asSupplement({ status: 'completed', content: NO_REPLY_MARKER, reply: NO_REPLY_MARKER }, 'zh-CN')).toBeUndefined();
    expect(asSupplement({ status: 'completed', content: '', reply: ` ${NO_REPLY_MARKER}\n（无需补充）` }, 'zh-CN')).toBeUndefined();
    expect(asSupplement({ status: 'completed', content: '(the agent finished without a reply)' }, 'zh-CN')).toBeUndefined();
    expect(asSupplement({ status: 'cancelled', content: 'stopped' }, 'zh-CN')).toBeUndefined();
  });

  it('marks new content as a supplement, in the human\'s language, without doubling an existing lead', () => {
    expect(asSupplement({ status: 'completed', content: 'x', reply: '它脖子上还有一个铃铛。' }, 'zh-CN')?.reply).toBe('补充：它脖子上还有一个铃铛。');
    expect(asSupplement({ status: 'completed', content: 'x', reply: '补充：它还有铃铛。' }, 'zh-CN')?.reply).toBe('补充：它还有铃铛。');
    expect(asSupplement({ status: 'completed', content: 'x', reply: 'It also wears a bell.' }, 'en-US')?.reply).toBe('Update: It also wears a bell.');
    expect(asSupplement({ status: 'budget_exceeded', content: 'x', reply: '部分结果' }, 'zh-CN')).toMatchObject({ status: 'budget_exceeded', reply: '补充：部分结果' });
  });

  it('tells a failure batch once even when the model declines; a cancelled supplement tells nothing (#1250)', () => {
    const declined = { status: 'completed' as const, content: '', reply: '[[no_reply]]' };
    expect(planSupplement(declined, { failures: false, locale: 'zh-CN' })).toEqual({ kind: 'nothing' });
    expect(planSupplement(declined, { failures: true, locale: 'zh-CN' })).toMatchObject({ kind: 'send', outcome: { status: 'completed', reply: '补充：后台任务没有完成。' } });
    expect(planSupplement({ status: 'completed', content: '' }, { failures: true, locale: 'en-US' }))
      .toMatchObject({ kind: 'send', outcome: { reply: 'Update: the background task did not finish.' } });
    // Stopped (user stop, hot reload): nothing reached the human, so the failure is not counted as told.
    expect(planSupplement({ status: 'cancelled', content: 'stopped' }, { failures: true, locale: 'zh-CN' })).toEqual({ kind: 'cancelled' });
    expect(planSupplement({ status: 'completed', content: '', reply: '饼图没画成。' }, { failures: true, locale: 'zh-CN' }))
      .toMatchObject({ kind: 'send', outcome: { reply: '补充：饼图没画成。' } });
  });

  it('keeps a failed entry turn so the human hears once that the follow-up could not be put together', () => {
    const failed = { status: 'failed' as const, content: 'boom' };
    expect(asSupplement(failed, 'zh-CN')).toBe(failed);
  });
});
