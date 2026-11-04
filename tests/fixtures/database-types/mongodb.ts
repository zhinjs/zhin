import { Registry } from '@zhin.js/database';
import { MongoDB, type MongoDBDialectConfig } from '@zhin.js/database/dialects/mongodb';
import type { MongoClientOptions } from 'mongodb';

type Tables = { users: { id: number; name: string } };
type NativePreserved = (MongoClientOptions & { url: string; dbName: string }) extends MongoDBDialectConfig ? true : false;
const nativePreserved: NativePreserved = true;
const config: MongoDBDialectConfig = { url: 'mongodb://localhost', dbName: 'type-contract', appName: 'type-contract', readPreference: 'secondaryPreferred', retryReads: false, serverSelectionTimeoutMS: 100 };
const database: MongoDB<Tables> = Registry.create<Tables, 'mongodb'>('mongodb', config, { users: { id: { type: 'integer' }, name: { type: 'text' } } });
database.model('users').select('name');
// @ts-expect-error native option types are retained
Registry.create<Tables, 'mongodb'>('mongodb', { url: 'mongodb://localhost', dbName: 'test', serverSelectionTimeoutMS: 'wrong' });
// @ts-expect-error actual concrete database models retain their schema
database.model('missing');
void nativePreserved;
