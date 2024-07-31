import { Connection, ConnectionOptions, createConnection, createPool, Pool, PoolOptions } from 'mysql2/promise';
import { Database } from '../types';
import { Dict } from '@zhinjs/shared';
import { dbFactories } from '../factory';

type ConnectOptions<T extends boolean = false> = {
  pool?: T;
} & (T extends true ? PoolOptions : ConnectionOptions);

export class MysqlDb<T extends boolean = false> implements Database {
  #connection?: MysqlDb.DynamicConnection<T>;

  constructor(private options: ConnectOptions<T>) {}
  async start() {
    this.#connection = (
      this.options.pool ? createPool(this.options) : await createConnection(this.options)
    ) as MysqlDb.DynamicConnection<T>;
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

    return true;
  }
  async import<T extends object>(data: T): Promise<boolean> {
    const connection = this.connection;
    const keys = Object.keys(data);
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
      const fieldsInfo = MysqlDb.getFieldsInfo(value);
      await connection.query(
        `CREATE TABLE IF NOT EXISTS ${key} (
          ${fieldsInfo}
        )`,
      );
      await connection.query(
        `INSERT INTO ${key}
                              SET ?`,
        [Reflect.get(data, key)],
      );
    }
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
  export function getFieldsInfo<T extends Array<Object>>(data: T): string[] {
    const keys = Object.keys(data[0]);
    return keys.map(key => `${key} ${typeTransforms.get(typeof data[0][key]) || 'varchar'}`);
  }
}
