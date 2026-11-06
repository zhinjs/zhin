import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProviderGraph } from '@zhin.js/ai/provider';
import { openHeadlessInferenceHost } from '@zhin.js/agent/runtime';

it('projects ambient selection from the held operation graph without loading Drivers or credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inference-ambient-status-'));
  const resolveSource = vi.fn();
  const runtime = await openHeadlessInferenceHost({
    projectRoot: directory,
    database: { dialect: 'sqlite', filename: ':memory:' },
    officialDrivers: false,
    resolveSource,
  });
  const { host, snapshots } = runtime;
  const credentialReads = vi.spyOn(host.repository, 'readCredential');
  const rootId = host.rootId;
  const ownerId = host.hostOwnerId;
  const graph: ProviderGraph = {
    rootId,
    revision: 1,
    services: {
      service: {
        id: 'service',
        rootId,
        ownerId,
        revision: 1,
        label: 'Language service',
        driver: {
          id: 'unloaded-third-party',
          owner: 'root/provider',
          contractVersion: '1',
        },
        options: {},
        models: {
          chat: { id: 'chat', protocol: 'fixture', kinds: ['language'] },
          ambient: { id: 'ambient', protocol: 'fixture', kinds: ['language'] },
        },
      },
    },
    accounts: {
      account: {
        id: 'account',
        rootId,
        ownerId,
        revision: 1,
        serviceId: 'service',
        incarnation: 'one',
        authentication: { method: 'api-key' },
      },
    },
    profiles: Object.fromEntries(
      ['chat', 'ambient'].map((id) => [
        id,
        {
          id,
          rootId,
          ownerId,
          revision: 1,
          accountId: 'account',
          model: id,
          parameters: {},
        },
      ])
    ),
    purposes: { defaults: { chat: 'chat' } },
  };
  const lease = snapshots.acquire();
  const input = { lease, signal: new AbortController().signal };
  try {
    expect(await host.ambientModels(input)).toEqual([]);
    await host.repository.commit({
      rootId,
      expectedRevision: 0,
      mutationId: 'chat',
      fingerprint: 'chat',
      graph,
      result: null,
    });
    expect(await host.ambientModels(input)).toEqual(['Language service/chat']);
    await host.repository.commit({
      rootId,
      expectedRevision: 1,
      mutationId: 'ambient',
      fingerprint: 'ambient',
      graph: {
        ...graph,
        revision: 2,
        purposes: { defaults: { chat: 'chat', ambient: 'ambient' } },
      },
      result: null,
    });
    expect(await host.ambientModels(input)).toEqual(['Language service/ambient']);
    expect(credentialReads).not.toHaveBeenCalled();
    expect(resolveSource).not.toHaveBeenCalled();
  } finally {
    lease.release();
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
