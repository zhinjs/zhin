import type { CoreReplyStream, ReplyStreamSnapshot } from '@zhin.js/core/runtime';
import { ReplyStreamRun } from '../../src/core/reply-stream-run.js';

afterEach(() => vi.useRealTimers());

it('does not throttle the first safe content behind an earlier JSON-only prefix', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const events: { at: number; snapshot: ReplyStreamSnapshot }[] = [];
  const stream: CoreReplyStream = { minIntervalMs: 500, receipt: { status: 'suppressed' }, confirmed: [],
    update: snapshot => { events.push({ at: Date.now(), snapshot }); },
    finish: async () => ({ status: 'sent' }), cancel: async () => ({ status: 'suppressed' }) };
  const run = new ReplyStreamRun(stream);
  run.begin(); run.append('{"reaction":"","messages":[');
  await vi.advanceTimersByTimeAsync(0);
  expect(events).toEqual([]);
  await vi.advanceTimersByTimeAsync(10);
  run.append('{"segments":[{"type":"text","data":{"text":"first');
  await vi.advanceTimersByTimeAsync(0);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ at: 10, snapshot: { messages: [{ segments: [{ value: { type: 'text', data: { text: 'first' } } }] }] } });
  await vi.advanceTimersByTimeAsync(10);
  run.append(' second');
  await vi.advanceTimersByTimeAsync(489);
  expect(events).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(events).toHaveLength(2);
  expect(events[1]).toMatchObject({ at: 510, snapshot: { messages: [{ segments: [{ value: { data: { text: 'first second' } } }] }] } });
  await run.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['submit', 'complete', 'stop'] as const)('preserves an interval beyond the Node timer range and clears it on %s', async ending => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const timerLimit = 2_147_483_647, interval = timerLimit + 1000;
  const updates: ReplyStreamSnapshot[] = [];
  const stream: CoreReplyStream = { minIntervalMs: interval, receipt: { status: 'suppressed' }, confirmed: [],
    update: snapshot => { updates.push(snapshot); }, finish: async () => ({ status: 'sent' }), cancel: async () => ({ status: 'suppressed' }) };
  const run = new ReplyStreamRun(stream);
  const header = '{"messages":[{"segments":[{"type":"text","data":{"text":"';
  run.begin(); run.append(header + 'first');
  await vi.advanceTimersByTimeAsync(0);
  expect(updates).toHaveLength(1);
  run.append(' second');
  await vi.advanceTimersByTimeAsync(1);
  expect(updates).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(timerLimit - 1);
  expect(updates).toHaveLength(1);
  if (ending === 'submit') {
    await vi.advanceTimersByTimeAsync(999);
    expect(updates).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(updates).toHaveLength(2);
    expect(updates[1]?.messages[0]?.segments[0]?.value).toEqual({ type: 'text', data: { text: 'first second' } });
    await run.stop();
  } else if (ending === 'complete') {
    expect((await run.complete(header + 'first second"}}]}]}'))?.messages[0]?.segments[0]?.value)
      .toEqual({ type: 'text', data: { text: 'first second' } });
  } else await run.stop();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(updates).toHaveLength(ending === 'submit' ? 2 : 1);
});

it.each([{ interval: 500, submissions: 7 }, { interval: 1000, submissions: 4 }])(
  'coalesces 300 synthetic deltas at $interval ms while preserving immediate first content and exact final text',
  async ({ interval, submissions }) => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const events: { at: number; snapshot: ReplyStreamSnapshot }[] = [];
    const stream: CoreReplyStream = {
      minIntervalMs: interval, receipt: { status: 'suppressed' }, confirmed: [],
      update: snapshot => { events.push({ at: Date.now(), snapshot }); },
      finish: async snapshot => { events.push({ at: Date.now(), snapshot }); return { status: 'sent' }; },
      cancel: async () => ({ status: 'suppressed' }),
    };
    const run = new ReplyStreamRun(stream);
    run.begin();
    const header = '{"messages":[{"segments":[{"type":"text","data":{"text":"';
    for (let index = 0; index < 300; index++) {
      run.append((index === 0 ? header : '') + 'x');
      if (index < 299) await vi.advanceTimersByTimeAsync(10);
    }
    const final = await run.complete(header + 'x'.repeat(300) + '"}}]}]}');
    expect(final).toBeDefined();
    await stream.finish(final!);
    expect(events[0]?.at).toBe(0);
    expect(events[0]?.snapshot.messages[0]?.segments[0]?.value).toEqual({ type: 'text', data: { text: 'x' } });
    expect(events.at(-1)?.at).toBe(2990);
    expect(events).toHaveLength(submissions);
    expect(events.at(-1)?.snapshot.messages[0]?.segments[0]?.value).toEqual({ type: 'text', data: { text: 'x'.repeat(300) } });
    // A complete-only sender cannot submit its answer before this same source has finished.
    expect(events[0]!.at).toBeLessThan(events.at(-1)!.at);
  },
);
