import { describe, expect, it } from 'vitest';
import {
  DATABASE_DIALECT_DEFINITIONS,
  databaseChoiceLabel,
  getDatabaseDialectDefinition,
  validateDatabaseConfig,
} from '../src/database-definitions.js';

describe('database dialect definitions', () => {
  it('publishes one schema and a visible verification baseline for every dialect', () => {
    expect(DATABASE_DIALECT_DEFINITIONS.map((definition) => definition.dialect)).toEqual([
      'sqlite', 'mysql', 'pg', 'mongodb', 'redis', 'memory',
    ]);
    for (const definition of DATABASE_DIALECT_DEFINITIONS) {
      expect(definition.schema).toMatchObject({ type: 'object' });
      expect(definition.verifiedServer).not.toBe('');
      expect(databaseChoiceLabel(definition)).toContain(`当前支持/实机验证 ${definition.verifiedServer}`);
      if (definition.driver) {
        expect(definition.driver.version).not.toBe('latest');
        expect(databaseChoiceLabel(definition)).toContain(
          `驱动 ${definition.driver.package} ${definition.driver.version}`,
        );
      }
    }
  });

  it('validates expanded PostgreSQL fields through its schema', () => {
    const config = {
      dialect: 'pg',
      host: '${DB_HOST}',
      port: '${DB_PORT}',
      user: '${DB_USER}',
      password: '${DB_PASSWORD}',
      database: '${DB_DATABASE}',
    };
    expect(validateDatabaseConfig(config, {
      DB_HOST: '127.0.0.1',
      DB_PORT: '5432',
      DB_USER: 'postgres',
      DB_PASSWORD: '',
      DB_DATABASE: 'zhin_bot',
    })).toEqual([]);
    expect(validateDatabaseConfig(config, {
      DB_HOST: '127.0.0.1',
      DB_PORT: 'not-a-port',
      DB_USER: 'postgres',
      DB_PASSWORD: '',
      DB_DATABASE: 'zhin_bot',
    })).toContainEqual(expect.objectContaining({
      kind: 'invalid',
      path: 'database.port',
    }));
  });

  it('reports an unresolved database environment variable with its exact path', () => {
    expect(validateDatabaseConfig({ dialect: 'pg', port: '${DB_PORT}' }, {})).toEqual([
      expect.objectContaining({
        kind: 'env_missing',
        path: 'database.port',
        envKey: 'DB_PORT',
      }),
    ]);
  });

  it('uses config environment fallbacks with the same semantics as runtime expansion', () => {
    expect(validateDatabaseConfig({ dialect: 'pg', port: '${DB_PORT:-5432}' }, {})).toEqual([]);
    expect(validateDatabaseConfig({ dialect: 'pg', port: '${DB_PORT:=5432}' }, { DB_PORT: '' })).toEqual([]);
  });

  it('rejects empty ports and unresolved embedded references', () => {
    expect(validateDatabaseConfig({ dialect: 'pg', port: '${DB_PORT}' }, { DB_PORT: '' }))
      .toContainEqual(expect.objectContaining({ kind: 'invalid', path: 'database.port' }));
    expect(validateDatabaseConfig({
      dialect: 'mongodb',
      url: 'mongodb://${DB_HOST}:27017',
      dbName: 'zhin',
    }, {})).toContainEqual(expect.objectContaining({
      kind: 'env_missing',
      path: 'database.url',
      envKey: 'DB_HOST',
    }));
  });

  it('enforces closed schemas', () => {
    expect(validateDatabaseConfig({ dialect: 'memory', extra: true }))
      .toContainEqual(expect.objectContaining({ kind: 'invalid', path: 'database.extra' }));
  });

  it('keeps the PostgreSQL definition explicit about pg and its verified versions', () => {
    expect(getDatabaseDialectDefinition('pg')).toMatchObject({
      name: 'PostgreSQL',
      verifiedServer: 'PostgreSQL 17',
      driver: { package: 'pg', version: '^8.22.0' },
    });
  });
});
