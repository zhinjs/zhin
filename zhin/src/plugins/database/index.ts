import { Plugin } from '@zhinjs/core';
export { LevelDb } from './adapters/level';
export { RedisDb } from './adapters/redis';
declare module '@zhinjs/core' {
  namespace App {
    interface Services {
      database: Database;
    }
    interface Config {
      db_driver: string;
      db_init_args: any[];
    }
  }
}
const database = new Plugin('数据库服务');
database.mounted(async app => {
  const factoryFn = Database.factories.get(app.config.db_driver || 'level');
  if (!factoryFn) throw new Error(`zhin not found: ${app.config.db_driver} driver`);
  const db = await factoryFn(...app.config.db_init_args);
  await db.start();
  database.service('database', db);
});
database.beforeUnmount(async app => {
  await app.database.stop();
});
export default database;
export type Database = {
  get<T = any>(key: string, defaultValue?: T): Promise<T>;
  filter<T>(key: string, predicate: Database.Predicate<T>): Promise<T>;
  find<T>(key: string, predicate: Database.Predicate<T>): Promise<Database.ArrayItem<T>>;
  indexOf<T>(key: string, predicate: Database.Predicate<T>): Promise<T>;
  includes<T>(key: string, predicate: Database.Predicate<T>): Promise<boolean>;
  set<T>(key: string, value: T): Promise<void>;
  replace<T>(key: string, oldValue: T, newValue: T): Promise<boolean>;
  replace<T>(key: string, predicate: Database.Predicate<T[]>, value: T): Promise<boolean>;
  splice<T>(key: string, index: number, deleteCount: number, ...insert: T[]): Promise<void>;
  remove<T>(key: string, predicate: T): Promise<void>;
  remove<T>(key: string, predicate: Database.Predicate<T[]>): Promise<void>;
  push<T>(key: string, ...value: T[]): Promise<void>;
  import<T extends object>(data: T): Promise<boolean>;
  start(): Promise<void>;
  stop(): Promise<void>;
  export(filename: string): Promise<boolean>;
};
export namespace Database {
  export type Predicate<T> = T extends (infer L)[] ? (item: L, index: number, list: T) => boolean : never;
  export type ArrayItem<T> = T extends (infer L)[] ? L : unknown;
  export type Factory<T = Database> = (...args: any[]) => T | Promise<T>;
  export const factories: Map<string, Factory> = new Map<string, Factory>();
}
