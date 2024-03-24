import { Dict, Merge } from './types';

export function isEmpty<T>(data: T) {
  if (!data) return true;
  if (typeof data !== 'object') return false;
  return Reflect.ownKeys(data).length === 0;
}

export function remove<T>(list: T[], item: T) {
  const index = list.indexOf(item);
  if (index !== -1) list.splice(index, 1);
}

export function deepClone<T>(obj: T): T {
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone) as T;
  if (!obj) return obj;
  const Constructor = obj.constructor;

  let newObj: T = Constructor() as T;
  for (let key in obj) {
    newObj[key] = deepClone(obj[key]) as any;
  }
  return newObj;
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
  const result = require('jiti')(__filename)(name);
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
export function deepMerge<First, Second>(first: First, second: Second): Merge<First, Second> {
  if (!first || typeof first !== typeof second || typeof first !== 'object') return first as any;
  const result = (Array.isArray(first) ? [] : {}) as Merge<First, Second>;
  for (const key of Reflect.ownKeys(first)) {
    Reflect.set(result, key, Reflect.get(first, key));
  }
  for (const key of Reflect.ownKeys(second as object)) {
    if (Reflect.has(result, key))
      Reflect.set(result, key, deepMerge(Reflect.get(result, key), Reflect.get(second as object, key)));
    else Reflect.set(result, key, Reflect.get(second as object, key));
  }
  return result;
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
export const wrapExport = (filePath: string) => {
  const result = require(filePath);
  if (result.default) {
    const { default: main, ...other } = result;
    return Object.assign(main, other);
  }
  return result;
};

export function setValueToObj(obj: Dict, keys: string[], value: any): boolean;
export function setValueToObj(obj: Dict, key: string, value: any): boolean;
export function setValueToObj(obj: Dict, key: string | string[], value: any) {
  const keys = Array.isArray(key) ? key : key.split('.').filter(Boolean);
  const lastKey = keys.pop();
  if (!lastKey) throw new SyntaxError(`key is empty`);
  while (keys.length) {
    const k = keys.shift() as string;
    obj = Reflect.get(obj, k);
    if (!obj) throw new SyntaxError(`can't set ${lastKey} to undefined`);
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
    if (!obj) throw new SyntaxError(`can't set ${lastKey} to undefined`);
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
