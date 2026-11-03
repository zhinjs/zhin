import type { CoreReplyStream, ReplyStreamSnapshot } from '@zhin.js/core/runtime';

const candidates = vi.hoisted(() => [] as {
  append: ReturnType<typeof vi.fn>;
  snapshot: ReturnType<typeof vi.fn>;
  finish: ReturnType<typeof vi.fn>;
  resolve(snapshot: ReplyStreamSnapshot | undefined): void;
}[]);
vi.mock('../../src/outbound/structured-reply-stream.js', () => ({
  createStructuredReplyStreamParser: () => {
    let resolve!: (snapshot: ReplyStreamSnapshot | undefined) => void;
    const pending = new Promise<ReplyStreamSnapshot | undefined>(done => { resolve = done; });
    const candidate = { append: vi.fn(), snapshot: vi.fn(() => pending), finish: vi.fn(async () => undefined), resolve };
    candidates.push(candidate);
    return candidate;
  },
}));
import { ReplyStreamRun } from '../../src/core/reply-stream-run.js';

beforeEach(() => { candidates.length = 0; vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());
const visible = (text: string): ReplyStreamSnapshot => ({ revision: 1, messages: [{ key: 'message-0', complete: false,
  segments: [{ key: 'segment-0', complete: false, value: { type: 'text', data: { text } } }] }] });
function fixture() {
  const update = vi.fn();
  const stream: CoreReplyStream = { receipt: { status: 'suppressed' }, confirmed: [], update,
    finish: vi.fn(async () => ({ status: 'suppressed' })), cancel: vi.fn(async () => ({ status: 'suppressed' })) };
  return { run: new ReplyStreamRun(stream), update };
}

it('retires the exact candidate while an older snapshot is still pending', async () => {
  const { run, update } = fixture();
  const epoch = run.begin(), first = candidates.at(-1)!;
  run.append('old prefix', epoch);
  await vi.advanceTimersByTimeAsync(0);
  expect(first.snapshot).toHaveBeenCalledOnce();
  const replacementEpoch = run.begin(), replacement = candidates.at(-1)!;
  run.append('stale suffix', epoch);
  run.append('new prefix', replacementEpoch);
  expect(first.append.mock.calls).toEqual([['old prefix']]);
  expect(replacement.append.mock.calls).toEqual([['new prefix']]);
  first.resolve(visible('old content'));
  await vi.advanceTimersByTimeAsync(0);
  expect(update).not.toHaveBeenCalled();
  expect(replacement.snapshot).toHaveBeenCalledOnce();
  replacement.resolve(visible('new content'));
  await vi.advanceTimersByTimeAsync(0);
  expect(update).toHaveBeenCalledExactlyOnceWith(visible('new content'));
  await run.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['stop', 'complete'] as const)('does not publish an in-flight snapshot after %s', async operation => {
  const { run, update } = fixture();
  run.begin(); const current = candidates.at(-1)!;
  run.append('partial');
  await vi.advanceTimersByTimeAsync(0);
  const done = operation === 'stop' ? run.stop() : run.complete('final raw');
  run.append('late');
  current.resolve(visible('old partial'));
  await done;
  expect(update).not.toHaveBeenCalled();
  expect(current.append.mock.calls).toEqual([['partial']]);
  expect(current.finish.mock.calls).toEqual(operation === 'stop' ? [] : [['final raw', 2]]);
  expect(vi.getTimerCount()).toBe(0);
});
