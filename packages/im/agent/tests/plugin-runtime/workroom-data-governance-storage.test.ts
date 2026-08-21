import { describe, expect, it, vi } from 'vitest';
import type {
  PayloadVaultObjectHandle,
  PayloadVaultReadInput,
} from '../../src/data-governance/disclosure-manifest.js';
import type {
  PayloadLifecycleEvent,
  PayloadLifecycleEventDraft,
  PayloadLifecycleJournal,
} from '../../src/data-governance/payload-lifecycle.js';
import {
  ActivatableWorkroomDataGovernanceStorage,
} from '../../src/plugin-runtime/workroom-data-governance-storage.js';
import type {
  WorkroomDataGovernancePayloadVaultPort,
} from '../../src/plugin-runtime/workroom-data-governance-runtime.js';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';

describe('Workroom Data Governance storage cutover', () => {
  it('keeps the writer unavailable until exact Lifecycle replay then writes Database only', async () => {
    const file = fakeVault('file');
    const database = fakeVault('database');
    const source = emptyLifecycle();
    const target = emptyLifecycle();
    const storage = new ActivatableWorkroomDataGovernanceStorage({
      generation: 7,
      fileVault: file.vault,
      fileLifecycle: source,
    });
    const write = sourceWrite();

    await expect(storage.vault.putSource(write, AbortSignal.timeout(1_000)))
      .rejects.toThrow('cutover is not active');

    const receipt = await storage.activateDatabase({
      vault: database.vault,
      lifecycle: target,
      projectIds: ['project-1'],
      repositoryIdentity: 'database:primary',
      signal: AbortSignal.timeout(1_000),
    });
    await storage.vault.putSource(write, AbortSignal.timeout(1_000));

    expect(receipt).toMatchObject({
      version: 1,
      generation: 7,
      source: 'file',
      target: 'database',
      streams: [],
    });
    expect(receipt.digest).toBe(digest({
      version: 1,
      generation: 7,
      source: 'file',
      target: 'database',
      repositoryIdentityDigest: digest({ repositoryIdentity: 'database:primary' }),
      streams: [],
    }));
    expect(database.putSource).toHaveBeenCalledOnce();
    expect(file.putSource).not.toHaveBeenCalled();
  });

  it('does not switch the Vault writer when Lifecycle replay fails', async () => {
    const file = fakeVault('file');
    const database = fakeVault('database');
    const storage = new ActivatableWorkroomDataGovernanceStorage({
      generation: 2,
      fileVault: file.vault,
      fileLifecycle: listedEmptyLifecycle(),
    });

    await expect(storage.activateDatabase({
      vault: database.vault,
      lifecycle: failingLifecycle(),
      projectIds: ['project-1'],
      repositoryIdentity: 'database:primary',
      signal: AbortSignal.timeout(1_000),
    })).rejects.toThrow('target unavailable');
    await expect(storage.vault.putSource(sourceWrite(), AbortSignal.timeout(1_000)))
      .rejects.toThrow('cutover is not active');
    expect(database.putSource).not.toHaveBeenCalled();
  });

  it('keeps old File handles readable after Database writer activation', async () => {
    const file = fakeVault('file', new Uint8Array([1, 2, 3]));
    const database = fakeVault('database', new Uint8Array([9]));
    const storage = new ActivatableWorkroomDataGovernanceStorage({
      generation: 3,
      fileVault: file.vault,
      fileLifecycle: emptyLifecycle(),
    });
    await storage.activateDatabase({
      vault: database.vault,
      lifecycle: emptyLifecycle(),
      projectIds: [],
      repositoryIdentity: 'database:primary',
      signal: AbortSignal.timeout(1_000),
    });

    expect(await storage.vault.readExact(readInput(), AbortSignal.timeout(1_000)))
      .toEqual(new Uint8Array([1, 2, 3]));
    expect(file.readExact).toHaveBeenCalledOnce();
    expect(database.readExact).not.toHaveBeenCalled();
  });
});

function fakeVault(name: string, body = new Uint8Array()): Readonly<{
  vault: WorkroomDataGovernancePayloadVaultPort;
  putSource: ReturnType<typeof vi.fn>;
  readExact: ReturnType<typeof vi.fn>;
}> {
  const putSource = vi.fn(async () => handle(name));
  const readExact = vi.fn(async () => body);
  return {
    putSource,
    readExact,
    vault: {
      putSource,
      putDerived: async () => handle(name),
      readExact,
      resolveLifecycleObject: async () => undefined,
    },
  };
}

function emptyLifecycle(): PayloadLifecycleJournal {
  return {
    read: async () => Object.freeze([]),
    append: async () => Object.freeze([]),
    listObjectIds: async () => Object.freeze([]),
  };
}

function listedEmptyLifecycle(): PayloadLifecycleJournal {
  return {
    ...emptyLifecycle(),
    listObjectIds: async () => Object.freeze(['object-1']),
  };
}

function failingLifecycle(): PayloadLifecycleJournal {
  return {
    read: async (): Promise<readonly PayloadLifecycleEvent[]> => {
      throw new Error('target unavailable');
    },
    append: async (
      _projectId: string,
      _objectId: string,
      _expectedSequence: number,
      _drafts: readonly PayloadLifecycleEventDraft[],
    ) => Object.freeze([]),
    listObjectIds: async () => Object.freeze([]),
  };
}

function sourceWrite() {
  return {
    descriptor: {
      objectId: 'object-1', payloadHash: digest({ body: 1 }), tenantId: 'tenant-1',
      projectId: 'project-1', kind: 'evidence' as const, confidentiality: 'internal' as const,
      categories: [], allowedPurposes: ['task_execution' as const], allowedRegions: [],
      subjectDigests: [], retention: { class: 'operational' as const, minimumRetainUntil: 0, deleteAfter: 1 },
      lineage: { sourceObjectIds: ['source-1'] },
    },
    descriptorDigest: digest({ descriptor: 1 }),
    payload: new Uint8Array([1]),
    sourceBindingDigest: digest({ source: 1 }),
  };
}

function handle(name: string): PayloadVaultObjectHandle {
  return {
    version: 1,
    vaultObjectId: `vault:${name}`,
    objectId: 'object-1',
    payloadHash: digest({ body: 1 }),
    descriptorDigest: digest({ descriptor: 1 }),
    tenantId: 'tenant-1',
    projectId: 'project-1',
    locationManifestDigest: digest({ location: name }),
  };
}

function readInput(): PayloadVaultReadInput {
  return {
    handle: handle('file'),
    requestDigest: digest({ request: 1 }),
    purpose: 'task_execution',
    principalId: 'principal-1',
    destinationId: 'destination-1',
  };
}
