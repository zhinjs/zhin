import { Registry } from '@zhin.js/database';
import { Redis, type RedisDialectConfig } from '@zhin.js/database/dialects/redis';
import type { RedisClientOptions } from 'redis';

type Tables = { cache: { value: string } };
type NativePreserved = RedisClientOptions extends RedisDialectConfig ? true : false;
const nativePreserved: NativePreserved = true;
const config: RedisDialectConfig = { url: 'redis://localhost', socket: { host: 'localhost', port: 6379, reconnectStrategy: false }, disableOfflineQueue: true, name: 'type-contract' };
const database: Redis<Tables> = Registry.create<Tables, 'redis'>('redis', config, { cache: { value: { type: 'text' } } });
database.model('cache');
// @ts-expect-error native option types are retained
Registry.create<Tables, 'redis'>('redis', { socket: { port: 'wrong' } });
// @ts-expect-error actual concrete database models retain their schema
database.model('missing');
void nativePreserved;
