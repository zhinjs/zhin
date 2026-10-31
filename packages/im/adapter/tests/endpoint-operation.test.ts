import { createEndpointOperation } from '../src/endpoint-operation.js';

it('ends a non-abortable native wait and never admits the next stage while retaining late-error ownership', async () => {
  const lifetime = new AbortController(), operation = createEndpointOperation({ signal: lifetime.signal });
  let rejectNative!: (reason: unknown) => void;
  const native = new Promise<void>((_resolve, reject) => { rejectNative = reject; });
  const first = operation.run(() => native); const failed = expect(first).rejects.toMatchObject({ disposition: 'unknown' });
  lifetime.abort(); await failed;
  const next = vi.fn(); await expect(operation.run(next)).rejects.toMatchObject({ disposition: 'unknown' }); expect(next).not.toHaveBeenCalled();
  rejectNative(new Error('late native failure')); await Promise.resolve();
});
it('removes cancellation listeners on native success, rejection and synchronous failure', async () => {
  const lifetime = new AbortController(), remove = vi.spyOn(lifetime.signal, 'removeEventListener');
  const operation = createEndpointOperation({ signal: lifetime.signal });
  await expect(operation.run(() => 42)).resolves.toBe(42);
  const failure = new Error('native failure');
  await expect(operation.run(() => Promise.reject(failure))).rejects.toBe(failure);
  await expect(operation.run(() => { throw failure; })).rejects.toBe(failure);
  expect(remove).toHaveBeenCalledTimes(3);
});

it('cleans its only listener after cancellation without claiming an unconfirmed SDK result failed', async () => {
  const caller = new AbortController(); const add = vi.spyOn(caller.signal, 'addEventListener'); const remove = vi.spyOn(caller.signal, 'removeEventListener');
  const operation = createEndpointOperation({ signal: caller.signal });
  const waiting = operation.run(() => new Promise(() => undefined));
  const outcome = expect(waiting).rejects.toMatchObject({ code: 'endpoint_inactive', disposition: 'unknown' });
  caller.abort(); await outcome; expect(add).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
  expect(remove.mock.calls[0]![1]).toBe(add.mock.calls[0]![1]);
});

it('keeps preparation cancellation not_sent but remembers previous effect submissions across subsequent stages', async () => {
  const before = new AbortController(), preparing = createEndpointOperation({ signal: before.signal });
  const waiting = preparing.prepare(() => new Promise<void>(() => undefined));
  const failed = expect(waiting).rejects.toMatchObject({ disposition: 'not_sent' }); before.abort(); await failed;
  const after = new AbortController(), publishing = createEndpointOperation({ signal: after.signal });
  await publishing.run(() => 'confirmed first bubble'); after.abort();
  const next = vi.fn(); await expect(publishing.prepare(next)).rejects.toMatchObject({ disposition: 'unknown' });
  await expect(publishing.run(next)).rejects.toMatchObject({ disposition: 'unknown' }); expect(next).not.toHaveBeenCalled();
});

it('preserves cancellation cause without copying private caller details into the public error message', async () => {
  const caller = new AbortController(), cause = new Error('synthetic private caller detail');
  const pending = createEndpointOperation({ signal: caller.signal }).run(() => new Promise<void>(() => undefined));
  const outcome = pending.catch(error => error); caller.abort(cause);
  const error = await outcome; expect(error.cause).toBe(cause); expect(error.message).not.toContain(cause.message);
});
