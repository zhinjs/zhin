import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { personalSessionOwnerId } from '@zhin.js/agent/personal-session';
import { hostModelOwnerId } from '@zhin.js/plugin-runtime';
import {
  previewInferenceMigration,
  verifyInferenceMigrationPreview,
} from '../../../src/instance/inference/migration-preview.js';
import { readLegacyInferenceSources } from '../../../src/instance/inference/migration-source.js';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'inference-metadata-migration-'));
  const document = {
    configVersion: 2,
    ai: {
      providers: {
        old: { sdk: 'openai', apiKey: 'synthetic-config-private-key', models: ['native'], input: ['text'] },
      },
      agents: { zhin: { provider: 'old', model: 'native' } },
    },
  };
  const file = join(root, 'zhin.config.json');
  await writeFile(file, JSON.stringify(document));
  await writeFile(join(root, '.env'), 'AI_KEY=must-not-be-loaded\n');
  const mapping = {
    version: 1 as const,
    services: {
      deployment: {
        old: {
          driver: 'openai',
          options: {},
          authentication: 'api-key' as const,
          models: {
            native: {
              id: 'native',
              protocol: 'openai-responses',
              kinds: ['language'],
              input: ['text'],
              toolCalling: true,
              streaming: true,
            },
          },
        },
      },
    },
  };
  return { root, document, file, mapping, close: () => rm(root, { recursive: true, force: true }) };
}
it('previews the selected raw Root without env expansion, database creation, plugin execution or raw key output', async () => {
  const f = await setup();
  try {
    const missing = await previewInferenceMigration({ root: f.root });
    expect(missing.units[0].migration.blocked).toContainEqual({
      path: 'providers.old',
      code: 'driver-selection-required',
    });
    const preview = await previewInferenceMigration({ root: f.root, mapping: f.mapping });
    expect(preview.units[0].migration.blocked).toEqual([]);
    expect(preview.stateSource).toBe('database-not-created');
    expect(preview.units[0].migration.credentials).toEqual([
      { accountAlias: 'account:old', source: { kind: 'legacy-config', path: 'providers.old.apiKey' } },
    ]);
    expect(JSON.stringify(preview)).not.toMatch(/synthetic-config-private-key|must-not-be-loaded/);
    expect(await readFile(f.file, 'utf8')).toBe(JSON.stringify(f.document));
    await expect(stat(join(f.root, '.zhin', 'data.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await verifyInferenceMigrationPreview(preview)).rootId).toBe(f.root);
    await writeFile(
      f.file,
      JSON.stringify({
        ...f.document,
        ai: {
          ...f.document.ai,
          providers: { old: { ...f.document.ai.providers.old, apiKey: 'different-private-material' } },
        },
      })
    );
    await expect(verifyInferenceMigrationPreview(preview)).rejects.toThrow('source changed');
  } finally {
    await f.close();
  }
});
it('reads legacy policy/catalog/Session metadata through SQLite read-only and does not confuse unrelated primitive state', async () => {
  const f = await setup(),
    filename = join(f.root, 'old.sqlite');
  const owner = { rootId: f.root, platform: 'qq', endpoint: 'one', adapterId: 'entry', subjectId: 'member' };
  const db = new DatabaseSync(filename);
  try {
    db.exec(
      'CREATE TABLE __zhin_persistent_state (id TEXT PRIMARY KEY, revision TEXT, value TEXT, expires_at INTEGER)'
    );
    const statement = db.prepare('INSERT INTO __zhin_persistent_state VALUES (?, ?, ?, NULL)');
    statement.run('ordinary', 'r', JSON.stringify('ordinary plugin string'));
    statement.run(
      'runtime-model-policy',
      'original-revision',
      JSON.stringify({
        version: 1,
        kind: 'runtime-model-policy',
        rootId: f.root,
        hostOwnerId: hostModelOwnerId(f.root),
        refsOverride: {},
      })
    );
    statement.run(
      'personal-catalog',
      'original-revision',
      JSON.stringify({
        version: 1,
        kind: 'personal-catalog',
        ownerId: personalSessionOwnerId(owner),
        catalog: {},
      })
    );
    statement.run(
      'personal-session',
      'original-revision',
      JSON.stringify({ version: 1, kind: 'personal-session', state: { identity: { owner } } })
    );
  } finally {
    db.close();
  }
  try {
    await writeFile(
      f.file,
      JSON.stringify({
        ...f.document,
        ai: { ...f.document.ai, personalPrincipals: { member: [owner] } },
        database: { dialect: 'sqlite', filename },
      })
    );
    const before = await readFile(filename);
    const source = await readLegacyInferenceSources({ root: f.root });
    expect(source.stateSource).toBe('sqlite-read-only');
    expect(source.stateRows.map((row) => row.value.kind).sort()).toEqual([
      'personal-catalog',
      'personal-session',
      'runtime-model-policy',
    ]);
    expect(await readFile(filename)).toEqual(before);
  } finally {
    await f.close();
  }
});
it('isolates a selected Root from another Root sharing SQLite without buffering or stamping foreign metadata', async () => {
  const f = await setup(),
    other = await setup(),
    filename = join(f.root, 'shared.sqlite');
  const db = new DatabaseSync(filename);
  try {
    db.exec(
      'CREATE TABLE __zhin_persistent_state (id TEXT PRIMARY KEY, revision TEXT, value TEXT, expires_at INTEGER)'
    );
    db.prepare('INSERT INTO __zhin_persistent_state VALUES (?, ?, ?, NULL)').run(
      'foreign-policy',
      'b1',
      JSON.stringify({
        version: 1,
        kind: 'runtime-model-policy',
        rootId: other.root,
        hostOwnerId: 'foreign-owner',
        refsOverride: {},
      })
    );
  } finally {
    db.close();
  }
  try {
    await writeFile(f.file, JSON.stringify({ ...f.document, database: { dialect: 'sqlite', filename } }));
    const source = await readLegacyInferenceSources({ root: f.root });
    expect(source.stateRows).toEqual([]);
    const preview = await previewInferenceMigration({ root: f.root, mapping: f.mapping });
    expect(preview.blocked).toEqual([]);
    const writer = new DatabaseSync(filename);
    try {
      writer
        .prepare('UPDATE __zhin_persistent_state SET revision = ?, value = ? WHERE id = ?')
        .run(
          'b2',
          JSON.stringify({
            version: 1,
            kind: 'runtime-model-policy',
            rootId: other.root,
            hostOwnerId: 'foreign-owner',
            refsOverride: { defaults: { chat: 'foreign-secret-profile' } },
          }),
          'foreign-policy'
        );
    } finally {
      writer.close();
    }
    expect((await readLegacyInferenceSources({ root: f.root })).stamp).toBe(source.stamp);
    await expect(verifyInferenceMigrationPreview(preview)).resolves.toMatchObject({ rootId: f.root });
  } finally {
    await f.close();
    await other.close();
  }
});

it('preserves a legacy Cloudflare accountId through the real built-in Service resolver', async () => {
  const f = await setup();
  try {
    await writeFile(f.file, JSON.stringify({ configVersion: 2, ai: {
      providers: { main: { sdk: 'cloudflare', accountId: 'synthetic-account', models: ['@cf/meta/llama-3.1-8b-instruct'], apiKey: '${CF_KEY}' } },
      agents: { zhin: { provider: 'main', model: '@cf/meta/llama-3.1-8b-instruct' } },
    } }));
    const preview = await previewInferenceMigration({ root: f.root, mapping: { version: 1, services: { deployment: {
      main: { driver: 'cloudflare', authentication: 'api-key', models: {
        '@cf/meta/llama-3.1-8b-instruct': { id: '@cf/meta/llama-3.1-8b-instruct', protocol: 'openai-chat', kinds: ['language'], input: ['text'] },
      } },
    } } } });
    const migration = preview.units[0].migration;
    expect(migration.blocked).toEqual([]);
    expect(migration.plan.services).toMatchObject({ 'service:main': { options: {
      accountId: 'synthetic-account', baseUrl: 'https://api.cloudflare.com/client/v4/accounts/synthetic-account/ai/v1',
    } } });
    expect(migration.credentials).toEqual([{ accountAlias: 'account:main', source: { kind: 'environment', reference: 'env://CF_KEY' } }]);
  } finally {
    await f.close();
  }
});
