import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

let requests = 0;
globalThis.fetch = async () => { requests++; throw new Error('External access is disabled in the archive check'); };
const canonical = await import('@zhin.js/database/registry');
const original = canonical.Registry.factories.get('memory');
class CustomMemory extends original {}
canonical.Registry.register('memory', CustomMemory);
const database = await import('@zhin.js/database');
assert.equal(database.Registry, canonical.Registry);
assert.equal(database.Registry.create('memory', {}).constructor, CustomMemory);
canonical.Registry.factories.set('memory', original);

const require = createRequire(import.meta.url);
assert.equal(require('@zhin.js/database').Registry, database.Registry);
assert.equal(require('@zhin.js/database/registry').Registry, database.Registry);
assert.deepEqual([...database.Registry.factories.keys()], ['memory', 'mysql', 'pg', 'redis', 'sqlite', 'mongodb']);
for (const name of ['PG', 'MySQL', 'MongoDB', 'Redis']) assert.equal(name in database, false);

const dialects = [
  ['mysql', { namedPlaceholders: true, pool: { max: 2 } }, 'MySQL', 'mysql2/promise'],
  ['pg', { statement_timeout: 100, application_name: 'archive-contract' }, 'PG', 'pg'],
  ['mongodb', { url: 'mongodb://localhost', dbName: 'archive-contract', appName: 'archive-contract' }, 'MongoDB', 'mongodb'],
  ['redis', { socket: { host: 'localhost', port: 6379 }, disableOfflineQueue: true }, 'Redis', 'redis'],
];
for (const [name, config, constructorName, sdk] of dialects) {
  assert.throws(() => require.resolve(sdk), { code: 'MODULE_NOT_FOUND' });
  const leaf = await import(`@zhin.js/database/dialects/${name}`);
  assert.equal(require(`@zhin.js/database/dialects/${name}`)[constructorName], leaf[constructorName]);
  assert.equal(typeof leaf[constructorName], 'function');
  const instance = database.Registry.create(name, config);
  assert.equal(instance.constructor, leaf[constructorName]);
  assert.equal(instance.isStarted, false);
  assert.deepEqual(instance.config, config);
  await assert.rejects(instance.start(), error => error instanceof Error && error.message.includes(sdk.split('/')[0]));
}

for (const [name, config] of [['memory', {}], ['sqlite', { filename: ':memory:' }]]) {
  const instance = database.Registry.create(name, config, { users: { id: { type: 'integer', primary: true }, name: { type: 'text' } } });
  try {
    await instance.start();
    await instance.model('users').create({ id: 1, name: 'synthetic' });
    assert.deepEqual(await instance.model('users').select('id', 'name'), [{ id: 1, name: 'synthetic' }]);
  } finally { await instance.stop(); }
}

for (const entry of ['@zhin.js/core', 'zhin.js', '@zhin.js/agent', '@zhin.js/agent/model-runtime', '@zhin.js/agent/turn']) {
  await import(entry);
}
assert.equal(requests, 0);
process.stdout.write(JSON.stringify({ passed: true, canonicalRegistry: true, builtinDialects: 6, localDatabases: 2,
  unavailableDrivers: 4, rootImports: 5, requests }) + '\n');
