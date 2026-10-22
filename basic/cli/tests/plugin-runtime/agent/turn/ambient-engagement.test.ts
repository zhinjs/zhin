import { describe, expect, it, vi } from 'vitest';
import {
  AmbientEngagement,
  parseJudgment,
  type EngagementJudge,
  type EngagementJudgment,
} from '../../../../src/plugin-runtime/agent/turn/ambient-engagement.js';

function harness(judgment: EngagementJudgment | Error, config: ConstructorParameters<typeof AmbientEngagement>[0]['config'] = {}) {
  let now = 1_000_000;
  const releases: Array<() => void> = [];
  const judge = { judge: vi.fn(async () => { if (judgment instanceof Error) throw judgment; return judgment; }) } satisfies EngagementJudge;
  const engagement = new AmbientEngagement({
    config: { conversations: ['icqq:1048877509'], ...config },
    judge,
    now: () => now,
    // Each wait resolves only when the test releases it, so bursts can overlap deterministically.
    sleep: () => new Promise<void>(resolve => releases.push(resolve)),
  });
  const consider = () => engagement.consider({ key: 'icqq:1048877509', botName: '小知', readRecent: async () => ['小林 (1): 有人知道怎么配代理吗'] });
  return {
    engagement, judge, consider,
    release: async () => { releases.splice(0).forEach(release => release()); await new Promise(resolve => setImmediate(resolve)); },
    advance: (ms: number) => { now += ms; },
  };
}

const yes: EngagementJudgment = { engage: true, confidence: 0.9, reason: 'unanswered question' };

describe('AmbientEngagement', () => {
  it('is enabled only for listed groups, or every group with *', () => {
    const { engagement } = harness(yes);
    expect(engagement.enabledFor('icqq', '1048877509')).toBe(true);
    expect(engagement.enabledFor('icqq', '1')).toBe(false);
    expect(harness(yes, { conversations: ['*'] }).engagement.enabledFor('qq', '1')).toBe(true);
  });

  it('judges a burst once, from its last message', async () => {
    const h = harness(yes);
    const first = h.consider();
    const second = h.consider();
    await h.release();
    await expect(first).resolves.toEqual({ kind: 'skipped', reason: 'superseded' });
    await expect(second).resolves.toEqual({ kind: 'engage', judgment: yes });
    expect(h.judge.judge).toHaveBeenCalledTimes(1);
    expect(h.judge.judge.mock.calls[0]![0]).toMatchObject({ botName: '小知', recent: ['小林 (1): 有人知道怎么配代理吗'] });
  });

  it('declines low-confidence or negative judgments', async () => {
    for (const judgment of [{ ...yes, confidence: 0.5 }, { ...yes, engage: false }]) {
      const h = harness(judgment);
      const decision = h.consider();
      await h.release();
      await expect(decision).resolves.toEqual({ kind: 'declined', judgment });
    }
  });

  it('answers someone talking with the bot without any cooldown', async () => {
    const h = harness(yes, { cooldownMs: 60_000, maxPerHour: 0 });
    h.engagement.noteSpoke('icqq:1048877509');
    h.advance(30_000);
    const reply = h.consider();
    await h.release();
    await expect(reply).resolves.toMatchObject({ kind: 'engage' });
    expect(h.judge.judge.mock.calls[0]![0]).toMatchObject({ inConversation: true, minutesSinceBotSpoke: 1 });
  });

  it('treats the group as idle again once the conversation window has passed', async () => {
    const h = harness(yes, { conversationWindowMs: 180_000, maxPerHour: 0 });
    h.engagement.noteSpoke('icqq:1048877509');
    h.advance(181_000);
    const decision = h.consider();
    await h.release();
    await expect(decision).resolves.toEqual({ kind: 'skipped', reason: 'hourly_cap' });
  });

  it('spaces unprompted interjections by the cooldown', async () => {
    const h = harness(yes, { cooldownMs: 60_000, conversationWindowMs: 0 });
    const first = h.consider();
    await h.release();
    await expect(first).resolves.toMatchObject({ kind: 'engage' });
    expect(h.judge.judge.mock.calls[0]![0]).toMatchObject({ inConversation: false });
    h.advance(30_000);
    const early = h.consider();
    await h.release();
    await expect(early).resolves.toEqual({ kind: 'skipped', reason: 'cooldown' });
    h.advance(31_000);
    const later = h.consider();
    await h.release();
    await expect(later).resolves.toMatchObject({ kind: 'engage' });
  });

  it('caps unprompted interjections per rolling hour', async () => {
    const h = harness(yes, { cooldownMs: 0, maxPerHour: 2, conversationWindowMs: 0 });
    const kinds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const decision = h.consider();
      await h.release();
      kinds.push((await decision).kind);
      h.advance(60_000);
    }
    expect(kinds).toEqual(['engage', 'engage', 'skipped']);
    h.advance(60 * 60_000);
    const afterHour = h.consider();
    await h.release();
    await expect(afterHour).resolves.toMatchObject({ kind: 'engage' });
  });

  it('keeps a safety ceiling on replies inside a conversation', async () => {
    const h = harness(yes);
    h.engagement.noteSpoke('icqq:1048877509');
    const kinds: string[] = [];
    for (let i = 0; i < 31; i++) {
      const decision = h.consider();
      await h.release();
      kinds.push((await decision).kind);
      h.advance(10_000);
    }
    expect(kinds.filter(kind => kind === 'engage')).toHaveLength(30);
    expect(kinds.at(-1)).toBe('skipped');
  });

  it('logs only in shadow mode and does not start a cooldown', async () => {
    const h = harness(yes, { mode: 'shadow' });
    for (let i = 0; i < 2; i++) {
      const decision = h.consider();
      await h.release();
      await expect(decision).resolves.toEqual({ kind: 'shadow', judgment: yes });
    }
  });

  it('stays quiet when the judge fails', async () => {
    const h = harness(new Error('rate limited'));
    const decision = h.consider();
    await h.release();
    await expect(decision).resolves.toEqual({ kind: 'skipped', reason: 'judge_failed' });
  });
});

describe('parseJudgment', () => {
  it('accepts lenient JSON and clamps confidence', () => {
    expect(parseJudgment('好的 {"engage":true,"confidence":1.4,"reason":"x"}')).toEqual({ engage: true, confidence: 1, reason: 'x' });
  });

  it.each(['', 'yes', '{"engage":"true","confidence":0.9}', '{"engage":true}'])('rejects %j', text => {
    expect(() => parseJudgment(text)).toThrow('Invalid engagement judgment');
  });
});
