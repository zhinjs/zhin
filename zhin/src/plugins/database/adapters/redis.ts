import { createClient, RedisClientOptions } from 'redis';
import { Database } from '../types';
import { WORK_DIR } from '@zhinjs/core';
import { Dict } from '@zhinjs/shared';
import * as fs from 'fs/promises';
import * as path from 'path';
import { dbFactories } from '../factory';
export class RedisDb implements Database {
  #client: ReturnType<typeof createClient>;
  constructor(options: RedisClientOptions) {
    this.#client = createClient(options);
  }
  get client(): ReturnType<typeof createClient> {
    if (!this.#client) throw new Error(`Client is not exists`);
    return this.#client!;
  }
  async import<T extends object>(data: T): Promise<boolean> {
    const client = this.client;
    const keys = Object.keys(data);
    for (const key of keys) {
      await client.set(key, JSON.stringify(Reflect.get(data, key)));
    }
    return true;
  }
  async #getArray<T>(key: string): Promise<T> {
    const result = await this.get<T>(key, [] as unknown as T);
    if (!Array.isArray(result)) throw new Error(`${key} is not an array`);
    return result;
  }
  async export(filename: string): Promise<boolean> {
    const client = this.client;
    const data: Dict = {};
    for (const key in (await client.scan(0)).keys) {
      const value = await client.get(key);
      if (value) data[key] = JSON.parse(value);
    }
    await fs.writeFile(path.resolve(WORK_DIR, filename), JSON.stringify(data, null, 2), 'utf8');
    return true;
  }

  async filter<T>(key: string, predicate: Database.Predicate<T>): Promise<T> {
    const data = await this.#getArray<T>(key);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    return (data as any).filter(predicate);
  }

  async find<T>(key: string, predicate: Database.Predicate<T>): Promise<Database.ArrayItem<T>> {
    const data = await this.#getArray<T>(key);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    return (data as any).find(predicate);
  }

  async get<T = any>(key: string, defaultValue?: T): Promise<T> {
    const value = await this.client.get(key);
    if (!value && !defaultValue) throw new Error(`Cannot find ${key} in redis`);
    if (!value) await this.client.set(key, JSON.stringify(defaultValue));
    return value ? JSON.parse(value) : defaultValue;
  }

  async includes<T>(key: string, predicate: Database.Predicate<T>): Promise<boolean> {
    const data = await this.#getArray<T>(key);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    return (data as any).includes(predicate);
  }

  async indexOf<T>(key: string, predicate: Database.Predicate<T>): Promise<T> {
    const data = await this.#getArray<T>(key);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    return (data as any).findIndex(predicate);
  }

  async push<T>(key: string, ...value: T[]): Promise<void> {
    const data = await this.#getArray<T>(key);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    data.push(...value);
    await this.set(key, data);
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.client.set(key, JSON.stringify(value));
  }

  async splice<T>(key: string, index: number, deleteCount: number, ...insert: T[]): Promise<void> {
    const data = await this.#getArray<T>(key);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    data.splice(index, deleteCount, ...insert);
    await this.set(key, data);
  }

  async replace<T>(key: string, oldValue: T | Database.Predicate<T[]>, newValue: T): Promise<boolean> {
    const data = await this.#getArray<T>(key);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    const index = typeof oldValue === 'function' ? data.findIndex(oldValue as any) : data.indexOf(oldValue);
    if (index === -1) return false;
    data[index] = newValue;
    await this.set(key, data);
    return true;
  }
  async remove<T>(key: string, predicate: T | Database.Predicate<T[]>): Promise<void> {
    const data = await this.get<T[]>(key, [] as T[]);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    const needRemoveData = data.filter((item, idx, list) => {
      if (typeof predicate === 'function') return (predicate as Database.Predicate<T[]>)(item, idx, list);
      return JSON.stringify(item) === JSON.stringify(predicate);
    });
    const newData = (data as any).filter((item: T) => !needRemoveData.includes(item));
    await this.set(key, newData);
  }
  async start(): Promise<void> {
    const client = this.client;
    return new Promise<void>((resolve, reject) => {
      client.on('connect', resolve);
      client.on('error', reject);
      client.connect();
    });
  }

  async stop(): Promise<void> {
    await this.#client?.quit();
  }
}
dbFactories.set('redis', (options: RedisClientOptions) => {
  return new RedisDb(options);
});
