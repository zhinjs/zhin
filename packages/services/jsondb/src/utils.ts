import { Dict } from 'zhin';
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
