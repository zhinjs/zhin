import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRemoteAgentRegistry } from '../../src/orchestrator/remote-agent-registry.js';

const card = {
  name: 'remote',
  description: 'test',
  version: '1.0.0',
  supportedInterfaces: [{
    url: 'https://remote.example/rpc',
    protocolBinding: 'JSONRPC',
    protocolVersion: '1.0',
    tenant: '',
  }],
  capabilities: { streaming: false, extensions: [] },
  securitySchemes: {},
  securityRequirements: [],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [],
  signatures: [],
};

describe('createRemoteAgentRegistry', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('publishes only after every configured Agent Card is ready', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(card), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchFn);

    const registry = await createRemoteAgentRegistry({
      remoteAgents: [{ id: 'remote', cardUrl: 'https://remote.example/card' }],
    }, new AbortController().signal);

    expect(registry.get('remote')?.card?.name).toBe('remote');
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('fails the candidate when a configured Agent Card is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));

    await expect(createRemoteAgentRegistry({
      remoteAgents: [{ id: 'remote', cardUrl: 'https://remote.example/card' }],
    }, new AbortController().signal)).rejects.toThrow('Agent Card fetch failed (503)');
  });

  it('rejects a successful HTTP response that is not an Agent Card', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));

    await expect(createRemoteAgentRegistry({
      remoteAgents: [{ id: 'remote', cardUrl: 'https://remote.example/card' }],
    }, new AbortController().signal)).rejects.toThrow('name is required');
  });

  it('rejects a card without a usable transport interface', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...card,
      supportedInterfaces: [],
    }), { status: 200 })));

    await expect(createRemoteAgentRegistry({
      remoteAgents: [{ id: 'remote', cardUrl: 'https://remote.example/card' }],
    }, new AbortController().signal)).rejects.toThrow('interfaces and capabilities are required');
  });

  it('rejects invalid and duplicate configured agents before publishing', async () => {
    const signal = new AbortController().signal;

    await expect(createRemoteAgentRegistry({
      remoteAgents: [{ id: '', cardUrl: 'https://remote.example/card' }],
    }, signal)).rejects.toThrow('id and cardUrl are required');
    await expect(createRemoteAgentRegistry({
      remoteAgents: [
        { id: 'remote', cardUrl: 'https://one.example/card' },
        { id: 'remote', cardUrl: 'https://two.example/card' },
      ],
    }, signal)).rejects.toThrow('duplicate id "remote"');
  });

  it('passes generation cancellation through Agent Card discovery', async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchFn);

    const creating = createRemoteAgentRegistry({
      remoteAgents: [{ id: 'remote', cardUrl: 'https://remote.example/card' }],
    }, controller.signal);
    controller.abort(new Error('generation cancelled'));

    await expect(creating).rejects.toThrow('generation cancelled');
  });

  it('cancels and drains tracked remote work before disposal completes', async () => {
    const registry = await createRemoteAgentRegistry({}, new AbortController().signal);
    let settled = false;
    registry.track(async (signal) => {
      try {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      } finally {
        settled = true;
      }
    });

    await registry.dispose();

    expect(settled).toBe(true);
  });
});
