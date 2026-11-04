import { createPendingRpc } from '../src/pending-rpc.js';

afterEach(() => vi.useRealTimers());
function fixture(signal?: AbortSignal) {
  const send = vi.fn<(payload: string) => void>();
  const rpc = createPendingRpc<string>({ signal, requestPrefix: 'test_', timeoutMs: 30_000,
    transport: () => ({ send }), serialize: request => JSON.stringify(request) });
  return { rpc, send };
}
it('owns independent pending maps, accepts only matching receipts and clears timers', async () => {
  vi.useFakeTimers(); const first = fixture(), second = fixture();
  const a = first.rpc.call({ action: 'write' }), b = second.rpc.call({ action: 'write' });
  first.rpc.accept({ id: 'test_1', value: 'first' }); await expect(a).resolves.toBe('first');
  expect(second.rpc.pendingCount).toBe(1); second.rpc.accept({ id: 'test_1', value: 'second' }); await expect(b).resolves.toBe('second');
  expect(vi.getTimerCount()).toBe(0); first.rpc.dispose(); second.rpc.dispose();
});
it('retirement cancels submitted work and refuses all later admissions', async () => {
  vi.useFakeTimers(); const account = new AbortController(), { rpc, send } = fixture(account.signal);
  const remove = vi.spyOn(account.signal, 'removeEventListener');
  const result = rpc.call({ action: 'write' }); const rejected = expect(result).rejects.toMatchObject({ disposition: 'unknown' });
  account.abort(); await rejected;
  await expect(rpc.call({ action: 'later' })).rejects.toMatchObject({ disposition: 'not_sent' });
  expect(send).toHaveBeenCalledOnce(); expect(rpc.pendingCount).toBe(0); expect(vi.getTimerCount()).toBe(0);
  rpc.dispose(); expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});
it('operation cancellation clears its listener and ignores late receipts without stopping siblings', async () => {
  vi.useFakeTimers(); const { rpc, send } = fixture(), operation = new AbortController();
  const remove = vi.spyOn(operation.signal, 'removeEventListener');
  const cancelled = rpc.call({ action: 'first', signal: operation.signal }); const rejected = expect(cancelled).rejects.toMatchObject({ disposition: 'unknown' });
  const sibling = rpc.call({ action: 'second' }); operation.abort(); await rejected;
  rpc.accept({ id: 'test_1', value: 'late' }); expect(rpc.pendingCount).toBe(1);
  rpc.accept({ id: 'test_2', value: 'sibling' }); await expect(sibling).resolves.toBe('sibling');
  expect(send).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0); expect(remove).toHaveBeenCalledWith('abort', expect.any(Function)); rpc.dispose();
});
it('cleans up synchronous send failure without claiming safe retry or leaving a timer', async () => {
  vi.useFakeTimers(); const { rpc, send } = fixture(); send.mockImplementation(() => { throw new Error('send failed'); });
  await expect(rpc.call({ action: 'write' })).rejects.toMatchObject({ message: 'send failed', disposition: 'unknown' });
  expect(rpc.pendingCount).toBe(0); expect(vi.getTimerCount()).toBe(0); rpc.dispose();
});
it('retains unknown timeout evidence and never replays an action', async () => {
  vi.useFakeTimers(); const { rpc, send } = fixture(); const result = rpc.call({ action: 'write' });
  const rejected = expect(result).rejects.toMatchObject({ disposition: 'unknown', code: 'endpoint_timeout' });
  await vi.advanceTimersByTimeAsync(30_000); await rejected; expect(send).toHaveBeenCalledOnce(); expect(rpc.pendingCount).toBe(0); rpc.dispose();
});
it('rejects before submission without retaining timers or listeners', async () => {
  vi.useFakeTimers(); const operation = new AbortController(); operation.abort(); const { rpc, send } = fixture();
  await expect(rpc.call({ action: 'write', signal: operation.signal })).rejects.toMatchObject({ disposition: 'not_sent' });
  expect(send).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); rpc.dispose();
});
it('reports encoding failure as not_sent without creating a pending wait', async () => {
  vi.useFakeTimers(); const send = vi.fn();
  const rpc = createPendingRpc({ requestPrefix: 'test_', timeoutMs: 30_000, transport: () => ({ send }),
    serialize() { throw new Error('invalid payload'); } });
  await expect(rpc.call({ action: 'write' })).rejects.toMatchObject({ disposition: 'not_sent', message: 'invalid payload' });
  expect(send).not.toHaveBeenCalled(); expect(rpc.pendingCount).toBe(0); expect(vi.getTimerCount()).toBe(0); rpc.dispose();
});
