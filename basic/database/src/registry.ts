import type { Database } from './base/database.js';
import type { Memory, MemoryConfig } from './dialects/memory.js';
import type { Sqlite, SQLiteDialectConfig } from './dialects/sqlite.js';

/**
 * 数据库注册表接口
 * 支持模块声明扩展
 */
export interface Databases<S extends Record<string, object> = Record<string, object>> {
  memory: Memory<S>;
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
    memory: MemoryConfig;
    sqlite: SQLiteDialectConfig;
  }
  export type DatabaseType = 'related' | 'document' | 'keyvalue';
  
  export function register<S extends Record<string, object>,D extends keyof Databases<S>>(
    dialect: D, 
    factory: Factory<Config[D], S,any>
  ): void {
    factories.set(dialect, factory as Factory<Config[D], S,any>);
  }
  
  export function create<S extends Record<string, object>, D extends keyof Databases<S>>(
    dialect: D,
    config: Config[D],
    definitions?: Database.DefinitionObj<S>
  ): Databases<S>[D] {
    const factory = factories.get(dialect);
    if (!factory) {
      throw new Error(`database dialect ${dialect} not registered`);
    }
    return new factory(config, definitions) as Databases<S>[D];
  }
}
