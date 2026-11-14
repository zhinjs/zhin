import { vi } from 'vitest';
import { createUserMessage } from '@zhin.js/ai';
import { getLogger } from '@zhin.js/logger';
import { modelRuntimeFixture } from '../helpers/model-runtime.js';
import { MAX_DELEGATION_RETENTION_MS } from '../../src/model-runtime/service.js';

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
    const researcher = await delegation.acquire({ operationId: 'r', sessionKey: 's#actor:researcher', agent: { name: 'researcher' } });
    expect([researcher.chat.binding.profile.id, researcher.purpose, researcher.chat.binding.source])
      .toEqual(['other', 'agent:researcher', { level: 'agent', name: 'researcher' }]);
    const planner = await delegation.acquire({ operationId: 'p', sessionKey: 's#actor:planner', agent: { name: 'planner' } });
    expect([planner.chat.binding.profile.id, planner.purpose]).toEqual(['text', 'chat']);
    const entry = await delegation.acquire({ operationId: 'z', sessionKey: 's#actor:zhin' });
    expect([entry.chat.binding.profile.id, entry.purpose]).toEqual(['text', 'chat']);
    await delegation.release();
    await root.release();
  });

  it('keeps a non-zhin root binding\'s purpose for the entry actor\'s aggregation turn', async () => {
    const f = modelRuntimeFixture({ bindingNames: ['support'] });
    f.update(withAgentProfile(f, { support: 'other' }));
    const root = await f.acquire({}, 'support');
    expect([root.chat.binding.profile.id, root.purpose]).toEqual(['other', 'agent:support']);
    const delegation = root.retainDelegation();
    await root.release();
    // The aggregation turn (entry actor) names no sub-agent: it continues the root's binding.
    const aggregation = await delegation.acquire({ operationId: 'agg', sessionKey: 's#actor:support' });
    expect([aggregation.chat.binding.profile.id, aggregation.purpose]).toEqual(['other', 'agent:support']);
    // A sub-agent of that root still never takes the binding's purpose.
    const researcher = await delegation.acquire({ operationId: 'r', sessionKey: 's#actor:researcher', agent: { name: 'researcher' } });
    expect([researcher.chat.binding.profile.id, researcher.purpose]).toEqual(['text', 'chat']);
    await delegation.release();
  });

  it('looks a sub-agent up by its qualified name first', async () => {
    const f = modelRuntimeFixture();
    f.update(withAgentProfile(f, { 'tools-plugin__researcher': 'other', researcher: 'text' }));
    const root = await f.acquire();
    const delegation = root.retainDelegation();
    const researcher = await delegation.acquire({ operationId: 'r', sessionKey: 's',
      agent: { name: 'researcher', qualifiedName: 'tools-plugin__researcher' } });
    expect([researcher.chat.binding.profile.id, researcher.purpose]).toEqual(['other', 'agent:tools-plugin__researcher']);
    await delegation.release();
    await root.release();
  });

  it('never resolves a sub-agent to the purpose of an Agent binding with the same name', async () => {
    const warn = vi.spyOn(getLogger('ai.model-runtime'), 'warn');
    const f = modelRuntimeFixture({ bindingNames: ['support'] });
    f.update(withAgentProfile(f, { support: 'other' }));
    const root = await f.acquire();
    const delegation = root.retainDelegation();
    const bare = await delegation.acquire({ operationId: 'a', sessionKey: 's', agent: { name: 'support', qualifiedName: 'helpdesk__support' } });
    expect([bare.chat.binding.profile.id, bare.purpose]).toEqual(['text', 'chat']);
    // A root-plugin sub-agent's qualified name is its bare name: still the binding's key.
    const rootPlugin = await delegation.acquire({ operationId: 'b', sessionKey: 's', agent: { name: 'support', qualifiedName: 'support' } });
    expect([rootPlugin.chat.binding.profile.id, rootPlugin.purpose]).toEqual(['text', 'chat']);
    expect(warn.mock.calls.some(([message]) => String(message).includes('belongs to the Agent binding'))).toBe(true);
    // The binding itself still selects it.
    const binding = await f.acquire({}, 'support');
    expect([binding.chat.binding.profile.id, binding.purpose]).toEqual(['other', 'agent:support']);
    await binding.release();
    await delegation.release();
    await root.release();
    warn.mockRestore();
  });

  it('falls back to chat with a warning when the bare name is shared by several sub-agents', async () => {
    const warn = vi.spyOn(getLogger('ai.model-runtime'), 'warn');
    const f = modelRuntimeFixture();
    f.update(withAgentProfile(f, { researcher: 'other' }));
    const root = await f.acquire();
    const delegation = root.retainDelegation();
    const shared = await delegation.acquire({ operationId: 'r', sessionKey: 's',
      agent: { name: 'researcher', qualifiedName: 'a__researcher', bareNameShared: true } });
    expect([shared.chat.binding.profile.id, shared.purpose]).toEqual(['text', 'chat']);
    expect(warn.mock.calls.some(([message]) => String(message).includes('ambiguous'))).toBe(true);
    await delegation.release();
    await root.release();
    warn.mockRestore();
  });

  it('releases a reservation held past the wall-clock cap and closes its open operations', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const f = modelRuntimeFixture();
      const root = await f.acquire();
      const delegation = root.retainDelegation();
      await root.release();
      const open = await delegation.acquire({ operationId: 'stuck', sessionKey: 's' });
      await expect(ask(open as never)).resolves.toMatchObject({ role: 'assistant' });
      await vi.advanceTimersByTimeAsync(MAX_DELEGATION_RETENTION_MS - 1);
      await expect(ask(open as never)).resolves.toMatchObject({ role: 'assistant' });
      await vi.advanceTimersByTimeAsync(1);
      await expect(ask(open as never)).rejects.toThrow(/operation-closed/u);
      expect(() => delegation.acquire({ operationId: 'late', sessionKey: 's' })).toThrow(/invalid-context/u);
      // The generation is free again.
      await expect(f.snapshots.close()).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
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
