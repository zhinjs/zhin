import { DatabaseOptions, Level } from 'level';
import { WORK_DIR, Dict, sleep } from '@zhinjs/core';
import * as fs from 'fs/promises';
import path from 'path';
import { Database } from '../';

export class LevelDb extends Level implements Database {
  async get<T>(key: string, defaultValue?: T): Promise<T> {
    if (this.status !== 'open') {
      await sleep(80);
      return this.get(key, defaultValue);
    }
    try {
      return await super.get<string, T>(key, { valueEncoding: 'json' });
    } catch (e) {
      if (!defaultValue) throw e;
      this.set(key, defaultValue);
      return this.get(key);
    }
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
  async indexOf<T>(key: string, predicate: Database.Predicate<T>): Promise<T> {
    const data = await this.get<T>(key, [] as T);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    return (data as any).findIndex(predicate);
  }
  async includes<T>(key: string, predicate: Database.Predicate<T>): Promise<boolean> {
    const data = await this.get<T>(key, [] as T);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    return (data as any).includes(predicate);
  }
  set<T>(key: string, value: T): Promise<void> {
    return super.put(key, value, {
      valueEncoding: 'json',
    });
  }
  async replace<T>(key: string, oldValue: T, newValue: T): Promise<boolean>;
  async replace<T>(key: string, predicate: Database.Predicate<T[]>, value: T): Promise<boolean>;
  async replace<T>(key: string, predicate: Database.Predicate<T[]> | T, value: T): Promise<boolean> {
    if (typeof predicate !== 'function') predicate = (item: T) => JSON.stringify(item) === JSON.stringify(predicate);
    const data = await this.get<T[]>(key, [] as T[]);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    const index = (data as any).findIndex(predicate);
    if (index === -1) return false;
    (data as any)[index] = value;
    await this.set(key, data);
    return true;
  }
  async splice<T>(key: string, index: number, deleteCount: number, ...insert: T[]) {
    const data = await this.get<T[]>(key, [] as T[]);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    (data as any).splice(index, deleteCount, ...insert);
    await this.set(key, data);
  }
  async remove<T>(key: string, predicate: Database.Predicate<T[]> | T): Promise<void> {
    if (typeof predicate !== 'function') predicate = (item: T) => JSON.stringify(item) === JSON.stringify(predicate);
    const data = await this.get<T[]>(key, [] as T[]);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    await this.set(key, (data as any).filter(predicate));
  }
  push<T>(key: string, ...value: T[]): Promise<void> {
    return this.get(key, [] as T).then(data => {
      if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
      data.push(...value);
      return this.set(key, data);
    });
  }
  async import<T extends object>(data: T) {
    const keys = Object.keys(data);
    for (const key of keys) {
      await this.set(key, Reflect.get(data, key));
    }
    return true;
  }
  async export(filename: string) {
    const data: Dict = {};
    for await (const [key, value] of this.iterator()) {
      data[key] = value;
    }
    await fs.writeFile(path.resolve(WORK_DIR, filename), JSON.stringify(data, null, 2), { encoding: 'utf8' });
    return true;
  }
  async start() {
    return this.open();
  }
  async stop() {
    return this.close();
  }
}
Database.factories.set('level', (filePath: string, options: DatabaseOptions<string, any>) => {
  return new LevelDb(path.resolve(WORK_DIR, filePath), options);
});
