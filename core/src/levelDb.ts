import { Level } from 'level';
import * as fs from 'fs/promises';
import path from 'path';
import { WORK_DIR } from './constans';
import { Dict } from './types';

export class LevelDb extends Level {
  async get<T>(key: string, defaultValue?: T): Promise<T> {
    try {
      return await super.get<string, T>(key, { valueEncoding: 'json' });
    } catch (e) {
      if (!defaultValue) throw e;
      this.set(key, defaultValue);
      return this.get(key);
    }
  }
  async filter<T>(key: string, predicate: LevelDb.Predicate<T>): Promise<T> {
    const data = await this.get<T>(key, [] as T);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    return (data as any).filter(predicate);
  }
  async find<T>(key: string, predicate: LevelDb.Predicate<T>): Promise<LevelDb.ArrayItem<T>> {
    const data = await this.get<T>(key, [] as T);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    return (data as any).find(predicate);
  }
  async indexOf<T>(key: string, predicate: LevelDb.Predicate<T>): Promise<T> {
    const data = await this.get<T>(key, [] as T);
    if (!Array.isArray(data)) throw new Error(`${key} is not an array`);
    return (data as any).findIndex(predicate);
  }
  async includes<T>(key: string, predicate: LevelDb.Predicate<T>): Promise<boolean> {
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
  async replace<T>(key: string, predicate: LevelDb.Predicate<T[]>, value: T): Promise<boolean>;
  async replace<T>(key: string, predicate: LevelDb.Predicate<T[]> | T, value: T): Promise<boolean> {
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
  async remove<T>(key: string, predicate: T): Promise<void>;
  async remove<T>(key: string, predicate: LevelDb.Predicate<T[]>): Promise<void>;
  async remove<T>(key: string, predicate: LevelDb.Predicate<T[]> | T): Promise<void> {
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
  }
  async export(filename: string) {
    const data: Dict = {};
    for await (const [key, value] of this.iterator()) {
      data[key] = value;
    }
    return fs.writeFile(path.resolve(WORK_DIR, filename), JSON.stringify(data, null, 2), { encoding: 'utf8' });
  }
}
export namespace LevelDb {
  export type Predicate<T> = T extends (infer L)[] ? (item: L, index: number, list: T) => boolean : never;
  export type ArrayItem<T> = T extends (infer L)[] ? L : unknown;
}
