import { createUserMessage } from '@zhin.js/ai';
import { modelRuntimeFixture } from '../helpers/model-runtime.js';

const ask = (scope: { chat: { model: unknown; completion: { complete: (...args: never[]) => Promise<unknown> } } }) =>
  scope.chat.completion.complete(scope.chat.model as never, { messages: [createUserMessage('hi')] } as never);

describe('#1250 actor turns run on their own delegated model operations', () => {
  it('serves model calls after the root turn released its operation (no operation-closed)', async () => {
    const f = modelRuntimeFixture();
    const root = await f.acquire();
    const delegation = root.retainDelegation();
    await root.release();
    // The root turn's own operation is closed: borrowing it is what failed before.
    await expect(ask(root as never)).rejects.toThrow(/operation-closed/u);
    const first = await delegation.acquire({ operationId: 'turn:actor:researcher:1', sessionKey: 's#actor:researcher' });
    await expect(ask(first as never)).resolves.toMatchObject({ role: 'assistant' });
    // One reservation serves every actor turn of the engagement.
    const second = await delegation.acquire({ operationId: 'turn:actor:zhin:2', sessionKey: 's#actor:zhin' });
    await expect(ask(second as never)).resolves.toMatchObject({ role: 'assistant' });
    await first.release();
    await expect(ask(second as never)).resolves.toMatchObject({ role: 'assistant' });
    await delegation.release();
    await expect(ask(second as never)).rejects.toThrow(/operation-closed/u);
    expect(() => delegation.acquire({ operationId: 'late', sessionKey: 's' })).toThrow(/invalid-context/u);
  });

  it('never holds the generation: closing the Root ends the reservation', async () => {
    const f = modelRuntimeFixture();
    const root = await f.acquire();
    const delegation = root.retainDelegation();
    await root.release();
    await expect(Promise.race([
      f.snapshots.close().then(() => 'closed'),
      new Promise(resolve => setTimeout(() => resolve('held'), 1_000)),
    ])).resolves.toBe('closed');
    expect(() => delegation.acquire({ operationId: 'late', sessionKey: 's' })).toThrow(/invalid-context/u);
  });
});
