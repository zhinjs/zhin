import type { CoreReplyStream, ReplyStreamSnapshot } from '@zhin.js/core/runtime';
import { ReplyStreamRun } from '../../src/core/reply-stream-run.js';

afterEach(() => vi.useRealTimers());

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
    expect(events.at(-1)?.at).toBe(2990);
    expect(events).toHaveLength(submissions);
    expect(events.at(-1)?.snapshot.messages[0]?.segments[0]?.value).toEqual({ type: 'text', data: { text: 'x'.repeat(300) } });
    // A complete-only sender cannot submit its answer before this same source has finished.
    expect(events[0]!.at).toBeLessThan(events.at(-1)!.at);
  },
);
