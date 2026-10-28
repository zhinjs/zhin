import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLOOD_THRESHOLD,
  DEFAULT_FLOOD_WINDOW_MS,
  GroupFloodDetector,
  MAX_FLOOD_TRACKED_MEMBERS,
  floodFingerprint,
  normalizeFloodText,
  type FloodObservation,
} from '../../../../src/plugin-runtime/agent/turn/group-flood-detector.js';

function say(detector: GroupFloodDetector, at: number, overrides: Partial<FloodObservation> = {}) {
  return detector.observe({ platform: 'icqq', groupId: '123', memberId: 'u-1', content: '大家快来看看这个', at, ...overrides });
}

describe('GroupFloodDetector (ADR 0039 slice D)', () => {
  it('uses the ADR defaults: 3 messages within 60 seconds', () => {
    const detector = new GroupFloodDetector();
    expect(detector.windowMs).toBe(DEFAULT_FLOOD_WINDOW_MS);
    expect(detector.threshold).toBe(DEFAULT_FLOOD_THRESHOLD);
    expect(DEFAULT_FLOOD_WINDOW_MS).toBe(60_000);
    expect(DEFAULT_FLOOD_THRESHOLD).toBe(3);
  });

  it('fires when one member repeats the same line 3 times within a minute (acceptance 5)', () => {
    const detector = new GroupFloodDetector();
    expect(say(detector, 0)).toEqual({ hit: false });
    expect(say(detector, 10_000)).toEqual({ hit: false });
    const verdict = say(detector, 20_000);
    expect(verdict).toMatchObject({ hit: true, count: 3, windowMs: 60_000 });
    expect(verdict.hit && verdict.samples).toEqual(['大家快来看看这个', '大家快来看看这个', '大家快来看看这个']);
  });

  it('does not fire when three members each say the same line once (acceptance 5)', () => {
    const detector = new GroupFloodDetector();
    expect(say(detector, 0, { memberId: 'u-1' })).toEqual({ hit: false });
    expect(say(detector, 1_000, { memberId: 'u-2' })).toEqual({ hit: false });
    expect(say(detector, 2_000, { memberId: 'u-3' })).toEqual({ hit: false });
  });

  it('keeps groups and platforms apart', () => {
    const detector = new GroupFloodDetector();
    say(detector, 0, { groupId: '1' });
    say(detector, 1_000, { groupId: '2' });
    expect(say(detector, 2_000, { platform: 'qq' })).toEqual({ hit: false });
  });

  it('does not fire when the repeats are spread beyond the window', () => {
    const detector = new GroupFloodDetector();
    say(detector, 0);
    say(detector, 40_000);
    expect(say(detector, 61_000)).toEqual({ hit: false });
    expect(say(detector, 70_000)).toMatchObject({ hit: true, count: 3 });
  });

  it('treats whitespace, punctuation, case and full-width variants as the same message', () => {
    const detector = new GroupFloodDetector();
    say(detector, 0, { content: 'Buy NOW!!!' });
    say(detector, 1_000, { content: 'buy now' });
    expect(say(detector, 2_000, { content: 'ｂｕｙ　ｎｏｗ。' })).toMatchObject({ hit: true });
  });

  it('counts highly similar long lines but not unrelated chatter', () => {
    const detector = new GroupFloodDetector();
    say(detector, 0, { content: '加我微信领取限时优惠券啦' });
    say(detector, 1_000, { content: '今天中午吃什么呢' });
    say(detector, 2_000, { content: '加我微信领取限时优惠券啦1' });
    expect(say(detector, 3_000, { content: '加我微信领取限时优惠券啦2' })).toMatchObject({ hit: true, count: 3 });
  });

  it('only counts exact repeats for short lines', () => {
    const detector = new GroupFloodDetector();
    say(detector, 0, { content: '哈哈哈' });
    say(detector, 1_000, { content: '哈哈哈哈' });
    expect(say(detector, 2_000, { content: '哈哈' })).toEqual({ hit: false });
  });

  it('fingerprints pure images / faces by content digest', () => {
    const detector = new GroupFloodDetector();
    const image = (url: string) => [{ type: 'image', data: { media: { kind: 'url', url } } }];
    say(detector, 0, { content: '[图片]', segments: image('https://a/1.png') });
    say(detector, 1_000, { content: '[图片]', segments: image('https://a/2.png') });
    expect(say(detector, 2_000, { content: '[图片]', segments: image('https://a/1.png') })).toEqual({ hit: false });
    expect(say(detector, 3_000, { content: '[图片]', segments: image('https://a/1.png') })).toMatchObject({ hit: true });

    const face = [{ type: 'face', data: { id: 178 } }];
    say(detector, 10_000, { memberId: 'u-2', content: '', segments: face });
    say(detector, 11_000, { memberId: 'u-2', content: '', segments: face });
    expect(say(detector, 12_000, { memberId: 'u-2', content: '', segments: face })).toMatchObject({ hit: true });
  });

  it('ignores reply quotes and empty messages', () => {
    expect(floodFingerprint('', [])).toBeUndefined();
    expect(floodFingerprint('  ！ ')).toBeUndefined();
    const a = floodFingerprint('同一句', [{ type: 'reply', data: { id: 'm1' } }, { type: 'text', data: { text: '同一句' } }]);
    const b = floodFingerprint('同一句', [{ type: 'reply', data: { id: 'm2' } }, { type: 'text', data: { text: '同一句' } }]);
    expect(a).toEqual(b);
    expect(floodFingerprint('x', [{ type: 'mention', data: { target: '42' } }, { type: 'text', data: { text: ' x ' } }]))
      .toEqual({ fingerprint: 't:@42x', text: '@42x' });
    expect(normalizeFloodText(' A，b ')).toBe('ab');
  });

  it('resets the member window after a hit', () => {
    const detector = new GroupFloodDetector();
    say(detector, 0);
    say(detector, 1_000);
    expect(say(detector, 2_000)).toMatchObject({ hit: true });
    expect(say(detector, 3_000)).toEqual({ hit: false });
    expect(say(detector, 4_000)).toEqual({ hit: false });
    expect(say(detector, 5_000)).toMatchObject({ hit: true });
  });

  it('honours custom window / threshold and clamps nonsense values', () => {
    const detector = new GroupFloodDetector({ windowMs: 5_000, threshold: 2 });
    say(detector, 0);
    expect(say(detector, 1_000)).toMatchObject({ hit: true, count: 2 });
    const clamped = new GroupFloodDetector({ windowMs: -1, threshold: 1_000 });
    expect(clamped.windowMs).toBe(1_000);
    expect(clamped.threshold).toBe(20);
  });

  it('keeps memory bounded: evicts least-recent members and prunes expired windows', () => {
    expect(MAX_FLOOD_TRACKED_MEMBERS).toBeGreaterThan(0);
    const detector = new GroupFloodDetector({ maxTrackedMembers: 3 });
    for (let index = 0; index < 5; index += 1) say(detector, index, { memberId: `u-${index}` });
    expect(detector.trackedSize).toBe(3);
    // u-0 was evicted: its earlier message no longer counts.
    say(detector, 10, { memberId: 'u-0' });
    expect(say(detector, 11, { memberId: 'u-0' })).toEqual({ hit: false });

    say(detector, 10 * 60_000, { memberId: 'late' });
    expect(detector.trackedSize).toBe(1);
    detector.clear();
    expect(detector.trackedSize).toBe(0);
  });
});
