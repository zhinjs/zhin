import { Database } from './base/database.js';
import { Memory } from './dialects/memory.js';
import { MongoDB } from './dialects/mongodb.js';
import {MySQL} from "./dialects/mysql.js";
import {PG} from "./dialects/pg.js";
import {Redis} from "./dialects/redis.js";
import {Sqlite} from "./dialects/sqlite.js";

/**
 * 数据库注册表接口
 * 支持模块声明扩展
 */
export interface Databases<S extends Record<string, object> = Record<string, object>> {
  memory: Memory<S>;
  mongodb: MongoDB<S>;
  mysql: MySQL<S>;
  pg: PG<S>;
  redis: Redis<S>;
  sqlite: Sqlite<S>;
}

/**
 * 数据库注册表命名空间
 */
export type Factory<D, S extends Record<string, object>,R extends Database<D, S, any>> ={
  new (config: D, definitions?: Database.DefinitionObj<S>): R;
}

export namespace Registry {
  export const factories=new Map<string, Factory<any, any,any>>();
  export interface Config{
    memory:import('./dialects/memory.js').MemoryConfig
    mongodb:import('./dialects/mongodb.js').MongoDBDialectConfig
    mysql:import('./dialects/mysql.js').MySQLDialectConfig
    pg:import('./dialects/pg.js').PostgreSQLDialectConfig
    redis:import('./dialects/redis.js').RedisDialectConfig
    sqlite:import('./dialects/sqlite.js').SQLiteDialectConfig
  }
  export type DatabaseType = 'related' | 'document' | 'keyvalue';
  
  export function register<S extends Record<string, object>,D extends keyof Databases<S>>(
    dialect: D, 
    factory: Factory<Config[D], S,any>
  ): void {
    factories.set(dialect, factory as Factory<Config[D], S,any>);
  }
  
  export function create<S extends Record<string, object>,D extends keyof Databases<S>>(
    dialect: D,
    config: Config[D],
    definitions?: Database.DefinitionObj<S>
  ): Database<Config[D], S, any> {
    const factory = factories.get(dialect) as Factory<Config[D], S,Database<Config[D],S,any>>;
    if (!factory) {
      throw new Error(`database dialect ${dialect} not registered`);
    }
    return new factory(config, definitions)
  }
}
