import { readFile } from 'node:fs/promises';
import * as database from '../src/index.js';

describe('optional database dialect entry contracts', () => {
  it('keeps the default entry neutral while registering all builtin constructors', () => {
    expect(database).toHaveProperty('Registry');
    expect(database).toHaveProperty('Memory');
    expect(database).toHaveProperty('Sqlite');
    for (const name of ['MySQL', 'MySQLDialect', 'PG', 'PostgreSQLDialect', 'Redis', 'RedisDialect', 'MongoDB', 'MongoDBDialect']) {
      expect(database).not.toHaveProperty(name);
    }
    expect([...database.Registry.factories.keys()]).toEqual(['memory', 'mysql', 'pg', 'redis', 'sqlite', 'mongodb']);
  });

  it.each([
    ['memory', {}, 'Memory'],
    ['mysql', { host: 'localhost', ssl: { rejectUnauthorized: true }, pool: { max: 2 } }, 'MySQL'],
    ['pg', { application_name: 'contract', statement_timeout: 123 }, 'PG'],
    ['redis', { socket: { host: 'localhost', port: 6379 } }, 'Redis'],
    ['sqlite', { filename: ':memory:' }, 'Sqlite'],
    ['mongodb', { url: 'mongodb://localhost', dbName: 'contract', appName: 'contract' }, 'MongoDB'],
  ] as const)('creates %s synchronously with the original options', (dialect, config, name) => {
    const instance = database.Registry.create(dialect, config as never);
    expect(instance.constructor.name).toBe(name);
    expect(instance.config).toEqual(config);
  });

  it('preserves explicit factory overrides and the unknown-dialect error', () => {
    const original = database.Registry.factories.get('memory')!;
    class CustomMemory<S extends Record<string, object>> extends database.Memory<S> {}
    try {
      database.Registry.register('memory', CustomMemory);
      expect(database.Registry.create('memory', {}).constructor).toBe(CustomMemory);
      expect(() => database.Registry.create('unregistered' as never, {} as never))
        .toThrow('database dialect unregistered not registered');
    } finally {
      database.Registry.factories.set('memory', original);
    }
  });

  it('publishes one canonical registry and each exact external dialect', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    expect(manifest.exports['./registry']).toMatchObject({ types: './lib/registry.d.ts', import: './lib/index.js', require: './lib/index.js' });
    for (const dialect of ['mysql', 'pg', 'mongodb', 'redis']) {
      const target = { types: `./lib/dialects/${dialect}.d.ts`, import: `./lib/dialects/${dialect}.js`, require: `./lib/dialects/${dialect}.js` };
      expect(manifest.exports[`./dialects/${dialect}`]).toMatchObject(target);
      expect(manifest.publishConfig.exports[`./dialects/${dialect}`]).toEqual(target);
    }
    expect(manifest.publishConfig.exports['./registry']).toEqual({ types: './lib/registry.d.ts', import: './lib/index.js', require: './lib/index.js' });
    expect(manifest.peerDependenciesMeta.pg.optional).toBe(true);
    expect(manifest.peerDependencies).not.toHaveProperty('@types/pg');
  });
});
