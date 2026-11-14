import { createUserMessage } from '@zhin.js/ai';
import { modelRuntimeFixture } from '../helpers/model-runtime.js';

function withAgentProfile(f: ReturnType<typeof modelRuntimeFixture>, agents: Record<string, string>) {
  const graph = f.graph;
  return { ...graph, profiles: { ...graph.profiles, other: { ...graph.profiles.text, id: 'other' } },
    purposes: { ...graph.purposes, agents } };
}

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

  it('selects the configured agent:<name> purpose and falls back to chat only when unconfigured', async () => {
    const f = modelRuntimeFixture();
    f.update(withAgentProfile(f, { researcher: 'other' }));
    const root = await f.acquire();
    expect([root.chat.binding.profile.id, root.purpose]).toEqual(['text', 'chat']);
    const delegation = root.retainDelegation();
    const researcher = await delegation.acquire({ operationId: 'r', sessionKey: 's#actor:researcher', agent: 'researcher' });
    expect([researcher.chat.binding.profile.id, researcher.purpose, researcher.chat.binding.source])
      .toEqual(['other', 'agent:researcher', { level: 'agent', name: 'researcher' }]);
    const planner = await delegation.acquire({ operationId: 'p', sessionKey: 's#actor:planner', agent: 'planner' });
    expect([planner.chat.binding.profile.id, planner.purpose]).toEqual(['text', 'chat']);
    const entry = await delegation.acquire({ operationId: 'z', sessionKey: 's#actor:zhin' });
    expect([entry.chat.binding.profile.id, entry.purpose]).toEqual(['text', 'chat']);
    await delegation.release();
    await root.release();
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
