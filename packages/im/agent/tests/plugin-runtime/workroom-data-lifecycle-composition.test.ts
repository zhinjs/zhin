import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFileWorkroomDataLifecycleRuntime } from '../../src/plugin-runtime/workroom-data-lifecycle-composition.js';

describe('createFileWorkroomDataLifecycleRuntime', () => {
  it('returns only narrow control/worker ports and is generation-cancelled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-data-lifecycle-composition-'));
    const generation = new AbortController();
    let resolverCalls = 0;
    try {
      const composition = createFileWorkroomDataLifecycleRuntime({
        stateRoot: root,
        generation: 7,
        signal: generation.signal,
        clock: { read: async () => undefined },
        authority: {
          authorize: async request => ({ approved: false, requestDigest: request.digest, reason: 'denied' }),
          verify: async () => false,
        },
        objects: {
          resolve: async () => {
            resolverCalls += 1;
            return undefined;
          },
        },
        subjects: { resolve: async () => undefined },
        deletion: { purge: async () => { throw new Error('unavailable'); } },
        receipts: { verify: async () => false },
      });
      expect(Object.keys(composition).sort()).toEqual(['control', 'worker']);
      expect(JSON.stringify(Object.keys(composition))).not.toMatch(/vault|crypto|authority|repository/iu);

      generation.abort(new DOMException('generation stopped', 'AbortError'));
      await expect(composition.control.register({
        version: 1,
        operationId: 'register-after-stop',
        authenticatedPrincipalId: 'principal:steward',
        handle: {
          version: 1,
          vaultObjectId: `vault-object:${'a'.repeat(64)}`,
          objectId: 'object-1',
          payloadHash: `sha256:${'b'.repeat(64)}`,
          descriptorDigest: `sha256:${'c'.repeat(64)}`,
          tenantId: 'tenant-1',
          projectId: 'project-1',
          locationManifestDigest: `sha256:${'d'.repeat(64)}`,
        },
      }, new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' });
      expect(resolverCalls).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a non-generation-owned composition', () => {
    const signal = new AbortController().signal;
    expect(() => createFileWorkroomDataLifecycleRuntime({
      stateRoot: '/unused', generation: 0, signal,
      clock: { read: async () => undefined },
      authority: {
        authorize: async request => ({ approved: false, requestDigest: request.digest, reason: 'denied' }),
        verify: async () => false,
      },
      objects: { resolve: async () => undefined },
      subjects: { resolve: async () => undefined },
      deletion: { purge: async () => { throw new Error('unavailable'); } },
      receipts: { verify: async () => false },
    })).toThrow('generation is invalid');
  });
});
