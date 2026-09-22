import { Request, type RequestBase } from '../src/request.js';
import { buildRequest } from '../src/side-event/normalize.js';
import { expectTypeOf, vi } from 'vitest';

const context = { endpoint: { adapter: 'root/qq', id: 'capability-1' }, generation: 7, client: () => ({ live: true }) };

describe('canonical Request', () => {
  it('preserves metadata, requester and asynchronous approval ports', async () => {
    const approve = vi.fn();
    const reject = vi.fn();
    const raw = { flag: 'f1', comment: 'native-comment' };
    const input = buildRequest(raw, {
      id: 'r1', type: 'request', name: 'request.friend.add',
      conversation: { kind: 'private', id: 'u1' }, timestamp: 1000,
      actor: { id: 'u1', name: 'User' }, comment: 'hello',
      $approve: approve, $reject: reject,
    });
    const request = new Request(input, context);
    expectTypeOf(request).toMatchTypeOf<RequestBase>();
    expect(request.metadata.flag).toBe('f1');
    expect(request).not.toHaveProperty('flag');
    expect(request.comment).toBe('hello');
    expect(request.actor).toEqual({ id: 'u1', name: 'User' });
    expect(request.conversation?.endpoint).toEqual(context.endpoint);
    await expect(request.$approve('remark')).resolves.toBeUndefined();
    await expect(request.$reject('reason')).resolves.toBeUndefined();
    expect(approve).toHaveBeenCalledWith('remark');
    expect(reject).toHaveBeenCalledWith('reason');
    expect(Object.isFrozen(request)).toBe(true);
  });
});
