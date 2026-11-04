import { Registry } from '@zhin.js/database';
import { MySQL, type MySQLDialectConfig } from '@zhin.js/database/dialects/mysql';
import type { ConnectionOptions } from 'mysql2/promise';

type Tables = { users: { id: number; name: string } };
type NativePreserved = ConnectionOptions extends MySQLDialectConfig ? true : false;
const nativePreserved: NativePreserved = true;
const config: MySQLDialectConfig = { ssl: { rejectUnauthorized: true }, namedPlaceholders: true, dateStrings: ['DATE'], supportBigNumbers: true, pool: { max: 2 } };
const database: MySQL<Tables> = Registry.create<Tables, 'mysql'>('mysql', config, { users: { id: { type: 'integer' }, name: { type: 'text' } } });
database.model('users').select('name');
// @ts-expect-error native option types are retained
Registry.create<Tables, 'mysql'>('mysql', { connectTimeout: 'wrong' });
// @ts-expect-error actual concrete database models retain their schema
database.model('missing');
void nativePreserved;
