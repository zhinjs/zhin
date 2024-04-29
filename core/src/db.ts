import * as fs from 'fs';
import * as path from 'path';
import { Dict } from './types';
import { aesDecrypt, aesEncrypt, parseObjFromStr, stringifyObj } from './utils';
export class JsonDB {
  private data: Dict = {};
  constructor(
    private readonly filePath: string,
    private key: string | Buffer = Buffer.from(filePath).subarray(0, 16),
  ) {
    const dir = path.dirname(this.filePath);
    if (this.key.length < 16) this.key = Buffer.from(this.key.toString().padEnd(16, '0'));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!this.filePath.endsWith('.runtime')) this.filePath = this.filePath + '.runtime';
    if (!fs.existsSync(this.filePath)) this.write();
    this.init();
  }
  private init() {
    this.read();
  }
  private get encryptedData() {
    return aesEncrypt(stringifyObj(this.data), Buffer.from(this.key)).toString('hex');
  }
  #decryptData(rawData: Buffer | string) {
    if (typeof rawData === 'string') rawData = Buffer.from(rawData, 'hex');
    return parseObjFromStr(aesDecrypt(rawData, Buffer.from(this.key)).toString('utf8'));
  }
  replace<T>(route: string, before: T, after: T) {
    const index = this.indexOf<T>(route, before);
    if (index < 0) return;
    return this.splice(route, index, 1, after);
  }
  remove<T>(route: string, before: T) {
    const index = this.indexOf(route, before);
    return this.splice(route, index, 1);
  }
  private write() {
    fs.writeFileSync(this.filePath, this.encryptedData, 'hex');
  }
  private read() {
    this.data = this.#decryptData(fs.readFileSync(this.filePath, 'hex'));
  }
  findIndex<T>(route: string, predicate: (value: T, index: number, obj: T[]) => unknown) {
    const arr = this.getArray<T>(route);
    return arr.findIndex(predicate);
  }
  indexOf<T>(route: string, item: T) {
    return this.findIndex<T>(route, value => {
      return stringifyObj(item) === stringifyObj(value);
    });
  }
  get<T>(route: string, initialValue?: T): T | undefined {
    this.read();
    const parentPath = route.split('.').filter(p => p.length);
    const key = parentPath.pop();
    if (!key) return this.data as T;
    let temp: Dict = this.data;
    while (parentPath.length) {
      const currentKey = parentPath.shift() as string;
      if (!Reflect.has(temp, currentKey)) Reflect.set(temp, currentKey, {});
      temp = Reflect.get(temp, currentKey);
    }
    if (!temp[key]) {
      temp[key] = initialValue;
      this.write();
    }
    return temp[key];
  }
  set<T>(route: string, data: T): T {
    const parentPath = route.split('.');
    const key = parentPath.pop();
    if (!key) throw new SyntaxError(`route can't empty`);
    const parentObj = this.get<Dict>(parentPath.join('.'), {});
    if (!parentObj) throw new SyntaxError(`can't set property ${key} of undefined`);
    parentObj[key] = data;
    this.write();
    return data;
  }
  delete(route: string): boolean {
    const parentPath = route.split('.');
    const key = parentPath.pop();
    if (!key) throw new SyntaxError(`route can't empty`);
    const parentObj = this.get<Dict>(parentPath.join('.'), {});
    if (!parentObj) throw new SyntaxError(`property ${key} is not exist of undefined`);
    const result = delete parentObj[key];
    this.write();
    return result;
  }
  private getArray<T>(route: string): T[] {
    if (!route) throw new Error(`route can't empty`);
    const arr = this.get<Dict>(route, []);
    if (!arr) throw new SyntaxError(`route ${route} is not define`);
    if (!Array.isArray(arr)) throw new TypeError(`data ${route} is not an Array`);
    return arr;
  }
  unshift<T>(route: string, ...data: T[]): number {
    const arr = this.getArray<T>(route);
    const result = arr.unshift(...data);
    this.write();
    return result;
  }
  shift<T>(route: string) {
    const arr = this.getArray<T>(route);
    const result = arr.shift();
    this.write();
    return result;
  }
  push<T>(route: string, ...data: T[]): number {
    const arr = this.getArray<T>(route);
    const result = arr.push(...data);
    this.write();
    return result;
  }
  pop<T>(route: string) {
    const arr = this.getArray<T>(route);
    const result = arr.pop();
    this.write();
    return result;
  }
  splice<T>(route: string, index: number = 0, deleteCount: number = 0, ...data: T[]): T[] {
    const arr = this.getArray<T>(route);
    const result = arr.splice(index, deleteCount, ...data);
    this.write();
    return result;
  }
  find<T>(route: string, callback: (item: T, index: number) => boolean): T | undefined {
    return this.getArray<T>(route).find(callback);
  }
  filter<T>(route: string, callback: (item: T, index: number) => boolean): T[] {
    return this.getArray<T>(route).filter(callback);
  }
}
