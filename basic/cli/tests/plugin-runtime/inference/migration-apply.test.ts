import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyInferenceMigration,
  finalizeInferenceMigration,
} from '../../../src/plugin-runtime/inference/migration-apply.js';
import { previewInferenceMigration } from '../../../src/plugin-runtime/inference/migration-preview.js';
import { openHeadlessInferenceHost } from '../../../src/plugin-runtime/inference/headless-host.js';
import { InferenceCredentialStore } from '../../../src/plugin-runtime/inference/credentials.js';
import { openAiProvider } from '@zhin.js/ai/providers';
import { resolveHostCredentialSource } from '../../../src/plugin-runtime/inference/environment-source.js';
import { validateModelRuntimeConfig } from '../../../../../packages/im/agent/src/model-runtime/validation.js';

async function setup(apiKey = 'synthetic-private-migration-key') {
  const root = await mkdtemp(join(tmpdir(), 'inference-offline-apply-'));
  const document = {
    configVersion: 2,
    ai: {
      enabled: true,
      providers: {
        old: { sdk: 'openai', apiKey, models: ['native'] },
      },
      agents: { zhin: { provider: 'old', model: 'native', nickname: '保留角色' } },
      agent: {
        providerResilience: {
          fallback: { maxAttempts: 2 },
          maxRetries: 3,
          requestTimeoutMs: 45_000,
        },
      },
    },
  };
  const file = join(root, 'zhin.config.json');
  await writeFile(file, JSON.stringify(document));
  const preview = await previewInferenceMigration({
    root,
    mapping: {
      version: 1,
      services: {
        deployment: {
          old: {
            driver: 'openai',
            options: {},
            authentication: 'api-key',
            models: {
              native: {
                id: 'native',
                protocol: 'openai-responses',
                kinds: ['language'],
                input: ['text'],
                streaming: true,
                toolCalling: true,
              },
            },
          },
        },
      },
    },
  });
  const options = { preview, maintenance: true, backupConfirmed: true, withCredentials: true };
  return {
    root,
    file,
    document,
    preview,
    options,
    close: () => rm(root, { recursive: true, force: true }),
  };
}
it('imports graph and raw-config credential together, preserves old source, resumes by the same receipt, then explicitly cuts over startup', async () => {
  const f = await setup();
  try {
    expect(f.preview.units.flatMap((unit) => unit.migration.blocked)).toEqual([]);
    expect(f.preview.retiredFields).toEqual(['ai.agent.providerResilience.fallback']);
    const applied = await applyInferenceMigration(f.options);
    expect(applied.phase).toBe('committed');
    expect(applied.graphMutations).toBe(1);
    expect(await readFile(f.file, 'utf8')).toBe(JSON.stringify(f.document));
    const opened = await openHeadlessInferenceHost({
      projectRoot: f.root,
      database: { dialect: 'sqlite', filename: join(f.root, '.zhin', 'data.sqlite') },
      resolveSource: vi.fn(),
    });
    try {
      const graph = await opened.host.repository.readGraph({ rootId: f.root });
      expect(Object.keys(graph!.accounts)).toHaveLength(1);
      const account = Object.values(graph!.accounts)[0];
      const vault = new InferenceCredentialStore({
        directory: join(f.root, '.zhin', 'inference'),
        repository: opened.host.repository,
      });
      const credential = await vault.read(account);
      expect(credential?.payload).toMatchObject({
        status: 'ready',
        method: 'api-key',
        key: 'synthetic-private-migration-key',
      });
      expect(JSON.stringify(graph)).not.toContain('synthetic-private-migration-key');
    } finally {
      await opened.close();
    }
    expect(await applyInferenceMigration(f.options)).toMatchObject({
      phase: 'committed',
      graphMutations: 1,
    });
    await expect(
      finalizeInferenceMigration({
        ...f.options,
        beforeFinalize: () => {
          throw new Error('synthetic file interruption');
        },
      })
    ).rejects.toThrow('interruption');
    expect(await readFile(f.file, 'utf8')).toBe(JSON.stringify(f.document));
    const finalized = await finalizeInferenceMigration(f.options);
    expect(finalized.phase).toBe('finalized');
    const startup = JSON.parse(await readFile(f.file, 'utf8'));
    expect(startup.ai).not.toHaveProperty('providers');
    expect(startup.ai.agents.zhin).toEqual({ nickname: '保留角色' });
    expect(startup.ai.agent.providerResilience).toEqual({
      maxRetries: 3,
      requestTimeoutMs: 45_000,
    });
    expect(validateModelRuntimeConfig(startup.ai, 'unused')).toEqual([]);
    expect(await readFile(finalized.backupFile, 'utf8')).toBe(JSON.stringify(f.document));
    expect(await finalizeInferenceMigration(f.options)).toMatchObject({ phase: 'finalized' });
  } finally {
    await f.close();
  }
});
it('requires explicit maintenance/backup/credential authority and refuses an active Root instead of stopping it', async () => {
  const f = await setup();
  try {
    await expect(applyInferenceMigration({ ...f.options, maintenance: false })).rejects.toThrow(
      'maintenance'
    );
    await writeFile(join(f.root, '.zhin.pid'), String(process.pid));
    await expect(applyInferenceMigration(f.options)).rejects.toThrow('Stop the running Bot');
    await rm(join(f.root, '.zhin.pid'));
    await expect(applyInferenceMigration({ ...f.options, withCredentials: false })).rejects.toThrow(
      'with-credentials'
    );
    expect(await readFile(f.file, 'utf8')).toBe(JSON.stringify(f.document));
  } finally {
    await f.close();
  }
});
it('recovers a committed graph by its original receipt after an acknowledgment loss without depending on changed source bytes', async () => {
  const f = await setup();
  const { DatabaseInferenceRepository } = await import(
    '../../../src/plugin-runtime/inference/repository.js'
  );
  const original = DatabaseInferenceRepository.prototype.commit;
  const commit = vi
    .spyOn(DatabaseInferenceRepository.prototype, 'commit')
    .mockImplementationOnce(async function (input) {
      const result = await original.call(this, input);
      if (result.status === 'committed')
        throw new Error('synthetic lost acknowledgment after SQL commit');
      return result;
    });
  try {
    await expect(applyInferenceMigration(f.options)).rejects.toThrow('lost acknowledgment');
    expect(commit).toHaveBeenCalledOnce();
    commit.mockRestore();
    await writeFile(
      f.file,
      JSON.stringify({
        ...f.document,
        ai: {
          ...f.document.ai,
          providers: {
            old: { ...f.document.ai.providers.old, apiKey: 'changed-after-old-commit' },
          },
        },
      })
    );
    const replay = vi.spyOn(DatabaseInferenceRepository.prototype, 'commit');
    expect(await applyInferenceMigration(f.options)).toMatchObject({
      phase: 'committed',
      graphMutations: 1,
    });
    expect(replay).not.toHaveBeenCalled();
    replay.mockRestore();
    await expect(finalizeInferenceMigration(f.options)).rejects.toThrow(
      'Startup configuration changed'
    );
  } finally {
    commit.mockRestore();
    await f.close();
  }
});
it('retains an unknown graph intent when no receipt can prove it and does not resubmit the executor', async () => {
  const f = await setup();
  const { DatabaseInferenceRepository } = await import(
    '../../../src/plugin-runtime/inference/repository.js'
  );
  const commit = vi
    .spyOn(DatabaseInferenceRepository.prototype, 'commit')
    .mockResolvedValueOnce({ status: 'commit-unknown' });
  try {
    expect(await applyInferenceMigration(f.options)).toMatchObject({
      phase: 'graph-unknown',
      graphMutations: 0,
    });
    expect(commit).toHaveBeenCalledOnce();
    commit.mockClear();
    expect(await applyInferenceMigration(f.options)).toMatchObject({
      phase: 'graph-unknown',
      graphMutations: 0,
    });
    expect(commit).not.toHaveBeenCalled();
    await expect(finalizeInferenceMigration(f.options)).rejects.toThrow(
      'Every database and Session mutation'
    );
  } finally {
    commit.mockRestore();
    await f.close();
  }
});
it('migrates an original-owner private vault and exact Session selection without decrypting at preview or flattening into Host', async () => {
  const f = await setup();
  const { createDatabaseHost } = await import(
    '../../../src/plugin-runtime/database-host-installer.js'
  );
  const { createHostDocumentCipher, createPrivateDocument } = await import(
    '../../../src/plugin-runtime/host-credential-storage.js'
  );
  const { legacyCatalogStateKey } = await import(
    '../../../src/plugin-runtime/inference/migration-source.js'
  );
  const { personalSessionIdentity, personalSessionOwnerId } = await import(
    '@zhin.js/agent/personal-session'
  );
  const { rootPluginId } = await import('@zhin.js/plugin-runtime');
  const { rename } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const identity = personalSessionIdentity({
    rootId: f.root,
    platform: 'icqq',
    endpoint: 'endpoint',
    subjectId: 'member',
    conversation: { endpoint: { adapter: 'icqq', id: 'root/account' }, kind: 'group', id: 'group' },
  });
  const ownerId = personalSessionOwnerId(identity.owner),
    directory = join(f.root, '.zhin', 'personal-model-credentials');
  const reference = `personal-model-secret:v1:${'a'.repeat(48)}`,
    cipher = createHostDocumentCipher(directory);
  const sealed = await cipher.seal(
    'synthetic-personal-vault-key',
    Buffer.from(JSON.stringify(['personal-model-credential', 1, ownerId, reference]))
  );
  await createPrivateDocument(
    directory,
    `${createHash('sha256').update(reference).digest('hex')}.json`,
    sealed
  );
  const database = createDatabaseHost({
    dialect: 'sqlite',
    filename: join(f.root, '.zhin', 'data.sqlite'),
  });
  await database.start();
  try {
    await database.state!.compareExchange(
      rootPluginId(),
      { kind: 'plugin' },
      legacyCatalogStateKey(ownerId),
      undefined,
      {
        version: 1,
        kind: 'personal-catalog',
        ownerId,
        revision: 1,
        catalog: {
          connections: {
            personal: { id: 'personal', ownerId, revision: 1, sdk: 'openai', secretRef: reference },
          },
          models: { chosen: { id: 'chosen', connectionId: 'personal', model: 'native' } },
          presets: { selected: { id: 'selected', modelId: 'chosen' } },
        },
      },
      null
    );
    await database.state!.compareExchange(
      rootPluginId(),
      { kind: 'plugin' },
      identity.key,
      undefined,
      JSON.parse(
        JSON.stringify({
          version: 1,
          kind: 'personal-session',
          state: { identity, revision: 1, selection: { kind: 'preset', presetId: 'selected' } },
        })
      ),
      null
    );
  } finally {
    await database.stop();
  }
  await writeFile(
    f.file,
    JSON.stringify({
      ...f.document,
      ai: { ...f.document.ai, personalPrincipals: { member: [identity.owner] } },
    })
  );
  await rename(join(directory, 'root-key.json'), join(directory, 'unavailable-during-preview'));
  try {
    const mapping = {
      driver: 'openai',
      authentication: 'api-key' as const,
      options: {},
      models: {
        native: {
          id: 'native',
          protocol: 'openai-responses',
          kinds: ['language'],
          input: ['text'],
          streaming: true,
          toolCalling: true,
        },
      },
    };
    const preview = await previewInferenceMigration({
      root: f.root,
      mapping: {
        version: 1,
        services: { deployment: { old: mapping }, [`catalog:${ownerId}`]: { personal: mapping } },
      },
    });
    expect(preview.blocked).toEqual([]);
    expect(preview.units.flatMap((unit) => unit.migration.blocked)).toEqual([]);
    expect(preview.sessions).toHaveLength(1);
    expect(preview.sessions[0].target).toEqual({
      unitId: `catalog:${ownerId}`,
      profileAlias: 'profile:selected',
    });
    expect(JSON.stringify(preview)).not.toContain('synthetic-personal-vault-key');
    await rename(join(directory, 'unavailable-during-preview'), join(directory, 'root-key.json'));
    const options = { ...f.options, preview };
    expect(await applyInferenceMigration(options)).toMatchObject({
      phase: 'committed',
      graphMutations: 2,
      migratedSessions: 1,
    });
    const opened = await openHeadlessInferenceHost({
      projectRoot: f.root,
      database: { dialect: 'sqlite', filename: join(f.root, '.zhin', 'data.sqlite') },
      resolveSource: vi.fn(),
    });
    try {
      const graph = await opened.host.repository.readGraph({ rootId: f.root });
      const account = Object.values(graph!.accounts).find(
        (account) => account.ownerId === ownerId
      )!;
      const vault = new InferenceCredentialStore({
        directory: join(f.root, '.zhin', 'inference'),
        repository: opened.host.repository,
      });
      expect((await vault.read(account))?.payload).toMatchObject({
        key: 'synthetic-personal-vault-key',
        method: 'api-key',
        status: 'ready',
      });
      const session = await opened.host.sessions.read({
        address: identity.address,
        owner: identity.owner,
      });
      expect(session.selection).toMatchObject({
        kind: 'profile',
        profile: { accountId: account.id, accountIncarnation: account.incarnation },
      });
      expect(
        Object.values(graph!.profiles).find((profile) => profile.accountId === account.id)?.ownerId
      ).toBe(ownerId);
      const oldCatalog = await opened.database.state!.read(
        rootPluginId(),
        { kind: 'plugin' },
        legacyCatalogStateKey(ownerId)
      );
      expect(oldCatalog?.value).toMatchObject({ kind: 'personal-catalog', revision: 1 });
    } finally {
      await opened.close();
    }
    expect(await applyInferenceMigration(options)).toMatchObject({
      phase: 'committed',
      graphMutations: 2,
      migratedSessions: 1,
    });
  } finally {
    await f.close();
  }
});


it.each([':-', ':='])('migrates a private environment default without offline resolution and resolves it at Host authorization (%s)', async operator => {
  const expression = `\${PRIVATE_KEY${operator}synthetic-private-default}`;
  const f = await setup(expression);
  try {
    expect(f.preview.units.flatMap(unit => unit.migration.blocked)).toEqual([]);
    expect(JSON.stringify(f.preview)).not.toContain('synthetic-private-default');
    expect(f.preview.units[0].migration.credentials[0].source).toEqual({ kind: 'legacy-environment-expression', path: 'providers.old.apiKey' });
    expect(await applyInferenceMigration(f.options)).toMatchObject({ phase: 'committed' });
    const lookup = vi.fn(() => undefined);
    const opened = await openHeadlessInferenceHost({
      projectRoot: f.root, database: { dialect: 'sqlite', filename: join(f.root, '.zhin', 'data.sqlite') },
      resolveSource: source => resolveHostCredentialSource(source, lookup),
    });
    try {
      const graph = (await opened.host.repository.readGraph({ rootId: f.root }))!;
      const account = Object.values(graph.accounts)[0], service = graph.services[account.serviceId];
      const profile = Object.values(graph.profiles)[0];
      const store = new InferenceCredentialStore({ directory: join(f.root, '.zhin', 'inference'), repository: opened.host.repository });
      expect((await store.read(account))?.payload).toMatchObject({ status: 'ready', method: 'api-key', source: { kind: 'environment-expression', expression } });
      expect((await store.read(account))?.payload).not.toHaveProperty('key');
      expect(lookup).not.toHaveBeenCalled();
      expect(JSON.stringify(graph)).not.toContain('synthetic-private-default');
      const grant = await opened.host.accounts.createPort({
        binding: { graphRevision: graph.revision, service, account, profile, model: service.models[profile.model] },
        context: { rootId: f.root, ownerId: opened.host.hostOwnerId, hostOwnerId: opened.host.hostOwnerId, operationId: 'synthetic-source', sessionKey: 'synthetic-session' },
        driver: openAiProvider, retainDriver: () => ({ reference: service.driver, definition: openAiProvider, release() {} }),
      }).authorize({ target: new URL('https://api.openai.com/v1/responses'), signal: new AbortController().signal });
      expect(grant.token).toBe('synthetic-private-default');
      expect(lookup).toHaveBeenCalledWith('PRIVATE_KEY');
    } finally { await opened.close(); }
  } finally { await f.close(); }
});
