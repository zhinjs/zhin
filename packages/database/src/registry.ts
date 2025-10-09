import { Database } from './base/database.js';
import type {MongoDBDialectConfig} from './dialects/mongodb';
import {RelatedDatabase} from "./type/related/database";
import {MemoryConfig} from "./types";
import {DocumentDatabase} from "./type/document/database";
import {MySQLDialectConfig} from "./dialects/mysql";
import {PostgreSQLDialectConfig} from "./dialects/pg";
import {RedisDialectConfig} from "./dialects/redis";
import {SQLiteDialectConfig} from "./dialects/sqlite";
import {KeyValueDatabase} from "./type/keyvalue/database";

/**
 * 数据库注册表接口
 * 支持模块声明扩展
 */
export interface Databases<S extends Record<string, object> = Record<string, object>> {
  memory: RelatedDatabase<MemoryConfig,S>;
  mongodb: DocumentDatabase<MongoDBDialectConfig,S>;
  mysql: RelatedDatabase<MySQLDialectConfig,S>;
  pg: RelatedDatabase<PostgreSQLDialectConfig,S>;
  redis: KeyValueDatabase<RedisDialectConfig,S>;
  sqlite: RelatedDatabase<SQLiteDialectConfig>;
}

/**
 * 数据库注册表命名空间
 */
export type Creator<D, S extends Record<string, object>> = (config: D, schemas?: Database.Schemas<S>) => Database<any, S, any>;
export type Constructor<D, S extends Record<string, object>> = new (config: D, schemas?: Database.Schemas<S>) => Database<any, S, any>;
export type Factory<D, S extends Record<string, object>> = Creator<any, S> | Constructor<any, S>;

export namespace Registry {
  export const factories=new Map();
  export type Config<T extends Database<any, any, any>> = T extends Database<infer D, any, any> ? D: any;
  export type DatabaseType = 'related' | 'document' | 'keyvalue';
  
  export function register<D extends string, S extends Record<string, object>>(
    dialect: D, 
    factory: Factory<any, S>
  ): void {
    factories.set(dialect, factory as Factory<any, S>);
  }
  
  export function create<D extends string, S extends Record<string, object>>(
    dialect: D,
    config: any,
    schemas?: Database.Schemas<S>
  ): any {
    const factory = factories.get(dialect) as Factory<any, S> | undefined;
    if (!factory) {
      throw new Error(`database dialect ${dialect} not registered`);
    }
    return (isConstructor(factory) ? new factory(config, schemas) : factory(config, schemas)) as any;
  }
  
  export function isConstructor<D, S extends Record<string, object>>(fn: Factory<D, S>): fn is Constructor<D, S> {
    return fn.prototype && fn.prototype.constructor === fn;
  }
}
