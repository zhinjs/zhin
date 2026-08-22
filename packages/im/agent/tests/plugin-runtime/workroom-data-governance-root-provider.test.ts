import { describe, expect, it, vi } from 'vitest';
import { Scope, rootPluginId } from '@zhin.js/plugin-runtime';
import {
  createWorkroomDataGovernanceRootProviderRequest,
  resolveWorkroomDataGovernanceRootAuthorities,
  workroomDataGovernanceRootProviderToken,
} from '../../src/plugin-runtime/workroom-data-governance-root-provider.js';

describe('Workroom Data Governance Root provider', () => {
  it('resolves exact generation-bound crypto and governance without snapshot exposure', async () => {
    const resources = new Scope(rootPluginId());
    const cryptography = { wrap: vi.fn(async () => null), unwrap: vi.fn(async () => null) };
    const governance = { verify: vi.fn(async () => true) };
    const resolve = vi.fn(async (request: ReturnType<typeof createWorkroomDataGovernanceRootProviderRequest>) => ({
      version: 1 as const,
      generation: request.generation,
      requestDigest: request.digest,
      providerId: 'kms:production-primary',
      cryptography,
      governance,
    }));
    resources.provide(workroomDataGovernanceRootProviderToken, { resolve });

    const result = await resolveWorkroomDataGovernanceRootAuthorities({
      resources,
      generation: 7,
      requester: rootPluginId(),
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({ providerId: 'kms:production-primary' });
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      version: 1,
      generation: 7,
      requester: 'root',
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    }), expect.any(AbortSignal));
    resources.seal();
    expect(resources.snapshot().has(workroomDataGovernanceRootProviderToken.id)).toBe(false);
  });

  it('fails closed on a stale provider echo and returns no fabricated fallback when absent', async () => {
    const absent = new Scope(rootPluginId());
    await expect(resolveWorkroomDataGovernanceRootAuthorities({
      resources: absent,
      generation: 3,
      requester: rootPluginId(),
      signal: new AbortController().signal,
    })).resolves.toBeUndefined();

    const stale = new Scope(rootPluginId());
    stale.provide(workroomDataGovernanceRootProviderToken, {
      resolve: async request => ({
        version: 1,
        generation: request.generation - 1,
        requestDigest: request.digest,
        providerId: 'kms:stale',
        cryptography: { wrap: async () => null, unwrap: async () => null },
        governance: { verify: async () => true },
      }),
    });
    await expect(resolveWorkroomDataGovernanceRootAuthorities({
      resources: stale,
      generation: 3,
      requester: rootPluginId(),
      signal: new AbortController().signal,
    })).rejects.toThrow('generation binding drift');
  });

  it('rejects an incomplete Root lifecycle authority bundle instead of bypassing object indexing', async () => {
    const resources = new Scope(rootPluginId());
    resources.provide(workroomDataGovernanceRootProviderToken, {
      resolve: async request => ({
        version: 1,
        generation: request.generation,
        requestDigest: request.digest,
        providerId: 'kms:missing-lifecycle-authority',
        cryptography: { wrap: async () => null, unwrap: async () => null },
        governance: { verify: async () => true },
        lifecycle: {
          registrationPrincipalId: 'data-steward:root-provider',
          clock: { read: async () => undefined },
          authority: { authorize: async () => ({ approved: false as const, requestDigest: '', reason: 'deny' }), verify: async () => false },
          subjects: { resolve: async () => undefined },
          deletion: {},
          receipts: { verify: async () => false },
        },
      }),
    });

    await expect(resolveWorkroomDataGovernanceRootAuthorities({
      resources,
      generation: 4,
      requester: rootPluginId(),
      signal: new AbortController().signal,
    })).rejects.toThrow('lifecycle capability is invalid');
  });
});
