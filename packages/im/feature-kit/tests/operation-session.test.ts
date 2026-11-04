import { describe, expect, it } from 'vitest';
import { operationSession, readOperationSession, type OperationSession } from '../src/index.js';

function fixture() {
  class NativeEvent { readonly bytes = Buffer.from('original'); original() { return this; } }
  const event = new NativeEvent();
  const session: OperationSession<'test'> = Object.freeze({ adapterName: 'test', adapter: {}, endpoint: {},
    scene: { endpoint: { adapter: 'adapter-owner', id: 'canonical' }, kind: 'private', id: 'peer' },
    message: { text: 'hello', receivedAt: 100 }, event, signal: new AbortController().signal,
    reply: async () => undefined });
  let active = true;
  const input = { [operationSession]() { if (!active) throw new Error('operation ended'); return session; } };
  return { input, session, event, end: () => { active = false; } };
}
describe('operation Session access', () => {
  it('keeps the one bound view and original SDK object through input/event envelopes', () => {
    const f = fixture();
    expect(readOperationSession(f.input, 'test')).toBe(f.session);
    expect(readOperationSession({ input: f.input }, 'test')).toBe(f.session);
    expect(readOperationSession({ payload: f.input }, 'test')).toBe(f.session);
    expect(readOperationSession(f.input)?.event).toBe(f.event);
    expect(f.event.original()).toBe(f.event);
    expect(Buffer.isBuffer(f.event.bytes)).toBe(true);
  });
  it('does not infer a Session from metadata or similarly named client fields', () => {
    const f = fixture();
    expect(readOperationSession({ session: f.session, metadata: { [operationSession]: () => f.session }, $client: {} })).toBeUndefined();
    const cycle: { input?: unknown } = {}; cycle.input = cycle;
    expect(readOperationSession(cycle)).toBeUndefined();
    expect(readOperationSession(undefined, 'test')).toBeUndefined();
  });
  it('preserves platform mismatch and operation lifetime errors', () => {
    const f = fixture();
    expect(() => readOperationSession(f.input, 'other')).toThrow('cannot access');
    f.end(); expect(() => readOperationSession(f.input)).toThrow('operation ended');
  });
});
