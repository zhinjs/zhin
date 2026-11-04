import { Registry } from '@zhin.js/database';
import { PG, type PostgreSQLDialectConfig } from '@zhin.js/database/dialects/pg';
import type { ClientConfig } from 'pg';

type Tables = { users: { id: number; name: string } };
type NativePreserved = ClientConfig extends PostgreSQLDialectConfig ? true : false;
const nativePreserved: NativePreserved = true;
const config: PostgreSQLDialectConfig = { ssl: { rejectUnauthorized: true }, application_name: 'type-contract', statement_timeout: 100, password: async () => 'synthetic', pool: { max: 2 } };
const database: PG<Tables> = Registry.create<Tables, 'pg'>('pg', config, { users: { id: { type: 'integer' }, name: { type: 'text' } } });
database.model('users').select('name');
// @ts-expect-error native option types are retained
Registry.create<Tables, 'pg'>('pg', { statement_timeout: 'wrong' });
// @ts-expect-error actual concrete database models retain their schema
database.model('missing');
void nativePreserved;
