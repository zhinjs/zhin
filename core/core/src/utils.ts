import crypto, { BinaryLike } from 'crypto';
import { Dict, Merge } from '@zhinjs/shared';
/**
 * AES encryption
 * @param data {BinaryLike} The data to encrypt
 * @param key {string|Buffer} The key to encrypt
 * @param iv {string|Buffer} The iv to encrypt,default is key.slice(0,16)
 * @return {Buffer} The encrypted data
 */
export function aesEncrypt(data: BinaryLike, key: string | Buffer, iv: string | Buffer = key.slice(0, 16)): Buffer {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/**
 * AES decryption
 * @param encryptedData {ArrayBufferView} The data to decrypt
 * @param key {string|Buffer} The key to decrypt
 * @param iv  {string|Buffer} The iv to decrypt, default is key.slice(0,16)
 * @return {Buffer} The decrypted data
 */
export function aesDecrypt(
  encryptedData: NodeJS.ArrayBufferView,
  key: string | Buffer,
  iv: string | Buffer = key.slice(0, 16),
): Buffer {
  let decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
}

/**
 * 寻找数组中最后一个符合条件的元素下标
 * @param list 数组
 * @param predicate 条件
 * @returns {number} 元素下标，未找到返回-1
 */
export function findLastIndex<T>(list: T[], predicate: (item: T, index: number) => boolean) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (predicate(list[i], i)) return i;
  }
  return -1;
}

export function trimQuote(str: string) {
  const quotes: string[][] = [
    ['"', '"'],
    ["'", "'"],
    ['`', '`'],
    ['“', '”'],
    ['‘', '’'],
  ];
  for (let i = 0; i < quotes.length; i++) {
    const [start, end] = quotes[i];
    if (str.startsWith(start) && str.endsWith(end)) {
      return str.slice(1, -1);
    }
  }
  return str;
}
export function loadModule<T = unknown>(name: string): T {
  const result = require(name);
  if (result.default) {
    const { default: plugin, ...other } = result;
    Object.assign(plugin, other);
    return plugin;
  }
  return result;
}

export function getCallerStack() {
  const origPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = function (_, stack) {
    return stack;
  };
  const err = new Error();
  const stack: NodeJS.CallSite[] = err.stack as unknown as NodeJS.CallSite[];
  Error.prepareStackTrace = origPrepareStackTrace;
  stack.shift(); // 排除当前文件的调用
  return stack;
}
export function formatSize(size: number): string {
  const units = [
    { name: 'PB', value: 1024 * 1024 * 1024 * 1024 * 1024 },
    { name: 'TB', value: 1024 * 1024 * 1024 * 1024 },
    { name: 'GB', value: 1024 * 1024 * 1024 },
    { name: 'MB', value: 1024 * 1024 },
    { name: 'KB', value: 1024 },
    { name: 'B', value: 1 },
  ];
  for (const unit of units) {
    if (size > unit.value) return Number(size / unit.value).toFixed(2) + unit.name;
  }
  return '';
}
/**
 * 格式化秒数为时间类型
 * @param seconds 秒数
 */
export function formatTime(seconds: number) {
  let result = '';
  const units = [
    { name: '年', value: 60 * 60 * 24 * 365 },
    { name: '月', value: 60 * 60 * 24 * 30 },
    { name: '天', value: 60 * 60 * 24 },
    { name: '小时', value: 60 * 60 },
    { name: '分钟', value: 60 },
    { name: '秒', value: 1 },
  ];
  for (const unit of units) {
    const value = Math.floor(seconds / unit.value);
    if (value > 0) {
      result += `${value} ${unit.name} `;
    }
    seconds %= unit.value;
  }
  return result.trimEnd();
}
export function formatDateTime(timestamp: number) {
  return new Date(timestamp + 1000 * 60 * 60 * 8)
    .toISOString()
    .split('T')
    .map(str => {
      return str.split('.')[0];
    })
    .join(' ');
}
export function getValueWithRuntime(template: string, ctx: Dict) {
  const result = evaluate(template, ctx);
  if (result === `return(${template})`) return template;
  return result;
}

export const evaluate = <S, T = any>(exp: string, context: S) => execute<S, T>(`return(${exp})`, context);

const evalCache: Record<string, Function> = Object.create(null);
export const execute = <S, T = any>(exp: string, context: S) => {
  const fn = evalCache[exp] || (evalCache[exp] = toFunction(exp));
  try {
    return fn.apply(context, [context]);
  } catch {
    return exp;
  }
};

const toFunction = (exp: string): Function => {
  try {
    return new Function(`$data`, `with($data){${exp}}`);
  } catch {
    return () => {};
  }
};

export function compiler(template: string, ctx: Dict) {
  const matched = [...template.matchAll(/\${([^}]*?)}/g)];
  for (const item of matched) {
    const tpl = item[1];
    let value = getValueWithRuntime(tpl, ctx);
    if (value === tpl) continue;
    if (typeof value !== 'string') value = JSON.stringify(value, null, 2);
    template = template.replace(`\${${item[1]}}`, value);
  }
  return template;
}

export function setValueToObj(obj: Dict, keys: string[], value: any): boolean;
export function setValueToObj(obj: Dict, key: string, value: any): boolean;
export function setValueToObj(obj: Dict, key: string | string[], value: any) {
  const keys = Array.isArray(key) ? key : key.split('.').filter(Boolean);
  const lastKey = keys.pop();
  if (!lastKey) throw new SyntaxError(`key is empty`);
  while (keys.length) {
    const k = keys.shift() as string;
    if (Reflect.get(obj, k) == null) {
      setValueToObj(obj, k, {})
    }
    obj = Reflect.get(obj, k)
    if (typeof obj !== 'object') {
      throw new TypeError(`can not set ${keys[0] || lastKey} property on a non-object called ${k}`)
    }
  }
  return Reflect.set(obj, lastKey, value);
}
export function getValueOfObj<T = any>(obj: Dict, key: string[]): T;
export function getValueOfObj<T = any>(obj: Dict, key: string): T;
export function getValueOfObj(obj: Dict, key: string | string[]) {
  const keys = Array.isArray(key) ? key : key.split('.').filter(Boolean);
  const lastKey = keys.pop();
  if (!lastKey) throw new SyntaxError(`key is empty`);
  while (keys.length) {
    const k = keys.shift() as string;
    obj = Reflect.get(obj, k);
    if (!obj) return null;
  }
  return Reflect.get(obj, lastKey);
}
export function getDataKeyOfObj(data: any, obj: Dict) {
  const _get = (data: any, obj: Dict, prefix: string[]): string | undefined => {
    for (const [key, value] of Object.entries(obj)) {
      if (value === data) return [...prefix, key].join('.');
      if (!value || typeof value !== 'object') continue;
      const result = _get(data, value, prefix);
      if (result) return result;
    }
  };
  return _get(data, obj, []);
}
export function parseObjFromStr(str: string) {
  const result = JSON.parse(str);
  const format = (data: any, keys: string[]): any => {
    if (!data) return;
    if (typeof data !== 'object' && typeof data !== 'string') return;
    if (typeof data === 'object') return Object.entries(data).map(([k, v]) => format(v, [...keys, k]));
    if (/\[Function:.+]/.test(data))
      return setValueToObj(result, [...keys], new Function(`return (${data.slice(10, -1)})`)());
    if (/\[Circular:.+]/.test(data)) setValueToObj(result, [...keys], getValueOfObj(result, data.slice(10, -1)));
  };
  format(result, []);
  return result;
}
export function stringifyObj(value: any): string {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return `[${value.map(stringifyObj).join()}]`;
  let result: Dict = { ...value },
    cache: WeakMap<object, any> = new WeakMap<object, any>();
  const _stringify = (obj: object, prefix: string[]) => {
    for (const key of Reflect.ownKeys(obj)) {
      const val = Reflect.get(obj, key);
      if (!val || typeof val !== 'object') {
        if (typeof val === 'function') {
          setValueToObj(result, [...prefix, String(key)], `[Function:${(val + '').replace(/\n/g, '')}]`);
          continue;
        }
        setValueToObj(result, [...prefix, String(key)], val);
        continue;
      }
      if (cache.has(val)) {
        setValueToObj(result, [...prefix, String(key)], `[Circular:${getDataKeyOfObj(val, value)}]`);
        continue;
      }
      cache.set(val, getValueOfObj(value, [...prefix, String(key)]));
      _stringify(val, [...prefix, String(key)]);
    }
  };
  _stringify(value, []);
  return JSON.stringify(result, null, 2);
}
const timeInfo = [
  {
    unit: 'w',
    text: '周',
    microSeconds: 1000 * 60 * 60 * 24 * 7,
  },
  {
    unit: 'd',
    text: '天',
    microSeconds: 1000 * 60 * 60 * 24,
  },
  {
    unit: 'h',
    text: '小时',
    microSeconds: 1000 * 60 * 60,
  },
  {
    unit: 'm',
    text: '分',
    microSeconds: 1000 * 60,
  },
  {
    unit: 's',
    text: '秒',
    microSeconds: 1000,
  },
];
export function parseTimeFromStr(dateStr: string) {
  const reg = /(\d+[wdhms])/g;
  const matched = dateStr.match(reg);
  if (!matched) throw new Error('invalid date str');
  let result = 0;
  for (const _temp of [...matched]) {
    const num = parseInt(_temp);
    const unit = _temp.replace(`${num}`, '');
    result += timeInfo.find(item => item.unit === unit)!.microSeconds * num || 0;
  }
  return result;
}
