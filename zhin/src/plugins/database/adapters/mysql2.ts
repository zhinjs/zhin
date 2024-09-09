import {
  Connection,
  ConnectionOptions,
  createConnection,
  createPool,
  Pool,
  PoolOptions,
  RowDataPacket,
} from 'mysql2/promise';
import { Database } from '../types';
import { Dict } from '@zhinjs/shared';
import { dbFactories } from '../factory';

type ConnectOptions<T extends boolean = false> = {
  pool?: T;
} & (T extends true ? PoolOptions : ConnectionOptions);

export class MysqlDb<T extends boolean = false> implements Database {
  #connection?: MysqlDb.DynamicConnection<T>;
  #database?: string;
  constructor(private options: ConnectOptions<T>) {}
  async start() {
    this.#connection = (
      this.options.pool ? createPool(this.options) : await createConnection(this.options)
    ) as MysqlDb.DynamicConnection<T>;
    this.#database = this.connection.config.database;
  }
  async stop() {
    if (this.#connection) await this.#connection.end();
    this.#connection = undefined;
  }
  get connection(): MysqlDb.DynamicConnection<T> {
    if (!this.#connection) throw new Error(`Connection is not exists`);
    return this.#connection!;
  }
  async export(filename: string): Promise<boolean> {
    const connection = this.connection;
    const data: Dict = {};
    for (const key in (await connection.query('SHOW TABLES'))[0]) {
      const result = await connection.query(`SELECT * FROM ${key}`);
      data[key] = result[0];
    }
    return true;
  }
  async get<T = any>(key: string, defaultValue?: T): Promise<T> {
    const hasTable = await this.#hasTable(key);
    if (!hasTable) await this.set(key, defaultValue);
    return this.connection.query(`SELECT * FROM ${key}`) as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (!Array.isArray(value)) value = [value] as any;
    this.connection.query(`CREATE TABLE IF NOT EXISTS ${key} (
      ${MysqlDb.getFieldsInfo(value as any)}
    )`);
  }

  async import<T extends object>(data: T): Promise<boolean> {
    const keys = Object.keys(data);
    try {
      for (const key of keys) {
        const value = Reflect.get(data, key);
        if (!Array.isArray(value)) {
          console.warn(`import data ${key} failed, value is not an array`);
          continue;
        }
        if (value.some(v => typeof v !== 'object')) {
          console.warn(`import data ${key} failed, value is not an object`);
          continue;
        }
        await this.set(key, value);
      }
    } catch (e) {
      console.error(e);
      return false;
    }
    return true;
  }

  async filter<T>(key: string, predicate: Database.Predicate<T>): Promise<T> {
    const data = await this.get<T>(key, [] as T);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    return (data as any).filter(predicate);
  }

  async find<T>(key: string, predicate: Database.Predicate<T>): Promise<Database.ArrayItem<T>> {
    const data = await this.get<T>(key, [] as T);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    return (data as any).find(predicate);
  }
  async #hasTable(key: string): Promise<boolean> {
    const [tables] = await this.connection.query<RowDataPacket[]>('SHOW TABLES');
    return tables.some(t => t[this.#database!] === key);
  }
  async includes<T>(key: string, predicate: Database.Predicate<T>): Promise<boolean> {
    const data = await this.get<T>(key, [] as T);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    return (data as any).includes(predicate);
  }

  async indexOf<T>(key: string, predicate: Database.Predicate<T>): Promise<T> {
    const data = await this.get<T>(key, [] as T);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    return (data as any).findIndex(predicate);
  }

  async push<T>(key: string, ...value: T[]): Promise<void> {
    const data = await this.get<T>(key, [] as T);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    data.push(...value);
    await this.set(key, data);
  }

  async splice<T>(key: string, index: number, deleteCount: number, ...insert: T[]): Promise<void> {
    const data = await this.get<T>(key);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    data.splice(index, deleteCount, ...insert);
    await this.set(key, data);
  }
  async remove<T>(key: string, predicate: Database.Predicate<T>): Promise<void> {
    const data = await this.get<T>(key);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    data.splice((data as any).findIndex(predicate), 1);
    await this.set(key, data);
  }
  async replace<T>(key: string, oldValue: T | Database.Predicate<T[]>, newValue: T): Promise<boolean> {
    const data = await this.get<T>(key);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    const index = typeof oldValue === 'function' ? data.findIndex(oldValue as any) : data.indexOf(oldValue);
    if (index === -1) return false;
    data[index] = newValue;
    await this.set(key, data);
    return true;
  }
}
export namespace MysqlDb {
  export type DynamicConnection<T extends boolean = false> = T extends true ? Pool : Connection;
  export const typeTransforms: Map<string, string> = new Map<string, string>();
  typeTransforms.set('number', 'integer');
  typeTransforms.set('string', 'varchar');
  typeTransforms.set('boolean', 'tinyint');
  typeTransforms.set('bigint', 'bigint');
  typeTransforms.set('object', 'json');
  typeTransforms.set('array', 'json');
  typeTransforms.set('Date', 'datetime');
  typeTransforms.set('any', 'json');
  function getType(value: any) {
    return Object.prototype.toString.call(value).slice(8, -1).toLowerCase();
  }
  export function getFieldsInfo<T extends Array<Object>>(data: T): string[] {
    const keys = Object.keys(data[0]);
    return keys.map(key => `${key} ${typeTransforms.get(getType(Reflect.get(data[0], key))) || 'varchar'}`);
  }
}

dbFactories.set('mysql2', (options: ConnectOptions) => {
  return new MysqlDb(options);
});
