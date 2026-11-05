import { Registry } from './registry.js';
import { Memory } from './dialects/memory.js';
import { MySQL } from './dialects/mysql.js';
import { PG } from './dialects/pg.js';
import { Redis } from './dialects/redis.js';
import { Sqlite } from './dialects/sqlite.js';
import { MongoDB } from './dialects/mongodb.js';

/** Root-entry initialization only; vendor clients are still loaded on connect. */
export function registerBuiltinDatabases(): void {
  Registry.register('memory', Memory);
  Registry.register('mysql', MySQL);
  Registry.register('pg', PG);
  Registry.register('redis', Redis);
  Registry.register('sqlite', Sqlite);
  Registry.register('mongodb', MongoDB);
}
