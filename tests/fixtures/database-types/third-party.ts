import { Registry, Sqlite, type Database, type Factory, type SQLiteDialectConfig } from '@zhin.js/database';
import { Registry as CanonicalRegistry } from '@zhin.js/database/registry';

type Tables = { users: { id: number; name: string }; audit: { key: string } };
class AuditedSqlite<S extends Record<string, object>> extends Sqlite<S> { readonly auditSource = 'custom'; }

declare module '@zhin.js/database/registry' {
  interface Databases<S extends Record<string, object> = Record<string, object>> { custom: AuditedSqlite<S>; }
  namespace Registry { interface Config { custom: SQLiteDialectConfig; } }
}

const definitions: Database.DefinitionObj<Tables> = { users: { id: { type: 'integer' }, name: { type: 'text' } } };
const factory: Factory<SQLiteDialectConfig, Tables, AuditedSqlite<Tables>> = AuditedSqlite;
CanonicalRegistry.register('custom', factory);
const first: AuditedSqlite<Tables> = Registry.create<Tables, 'custom'>('custom', { filename: ':memory:' }, definitions);
const second: AuditedSqlite<Tables> = CanonicalRegistry.create<Tables, 'custom'>('custom', { filename: ':memory:' });
first.model('users').select('name');
second.model('audit').select('key');
// @ts-expect-error both entries retain the actual required config
Registry.create<Tables, 'custom'>('custom', {});
// @ts-expect-error canonical config fields retain their real types
CanonicalRegistry.create<Tables, 'custom'>('custom', { filename: 1 });
// @ts-expect-error both entries preserve generic schema keys
second.model('missing');
// @ts-expect-error selected models retain their own columns
second.model('audit').select('id');
// @ts-expect-error actual definition value types survive module augmentation
const invalid: Database.DefinitionObj<Tables> = { users: { id: { type: 'integer', default: 'wrong' }, name: { type: 'text' } } };
void invalid;
