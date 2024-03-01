"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stringifyObj = exports.parseObjFromStr = exports.getDataKeyOfObj = exports.getValueOfObj = exports.setValueToObj = void 0;
function setValueToObj(obj, key, value) {
    const keys = Array.isArray(key) ? key : key.split('.').filter(Boolean);
    const lastKey = keys.pop();
    if (!lastKey)
        throw new SyntaxError(`key is empty`);
    while (keys.length) {
        const k = keys.shift();
        obj = Reflect.get(obj, k);
        if (!obj)
            throw new SyntaxError(`can't set ${lastKey} to undefined`);
    }
    return Reflect.set(obj, lastKey, value);
}
exports.setValueToObj = setValueToObj;
function getValueOfObj(obj, key) {
    const keys = Array.isArray(key) ? key : key.split('.').filter(Boolean);
    const lastKey = keys.pop();
    if (!lastKey)
        throw new SyntaxError(`key is empty`);
    while (keys.length) {
        const k = keys.shift();
        obj = Reflect.get(obj, k);
        if (!obj)
            throw new SyntaxError(`can't set ${lastKey} to undefined`);
    }
    return Reflect.get(obj, lastKey);
}
exports.getValueOfObj = getValueOfObj;
function getDataKeyOfObj(data, obj) {
    const _get = (data, obj, prefix) => {
        for (const [key, value] of Object.entries(obj)) {
            if (value === data)
                return [...prefix, key].join('.');
            if (!value || typeof value !== 'object')
                continue;
            const result = _get(data, value, prefix);
            if (result)
                return result;
        }
    };
    return _get(data, obj, []);
}
exports.getDataKeyOfObj = getDataKeyOfObj;
function parseObjFromStr(str) {
    const result = JSON.parse(str);
    const format = (data, keys) => {
        if (!data)
            return;
        if (typeof data !== 'object' && typeof data !== 'string')
            return;
        if (typeof data === 'object')
            return Object.entries(data).map(([k, v]) => format(v, [...keys, k]));
        if (/\[Function:.+]/.test(data))
            return setValueToObj(result, [...keys], new Function(`return (${data.slice(10, -1)})`)());
        if (/\[Circular:.+]/.test(data))
            setValueToObj(result, [...keys], getValueOfObj(result, data.slice(10, -1)));
    };
    format(result, []);
    return result;
}
exports.parseObjFromStr = parseObjFromStr;
function stringifyObj(value) {
    if (!value || typeof value !== 'object')
        return value;
    if (Array.isArray(value))
        return `[${value.map(stringifyObj).join()}]`;
    let result = { ...value }, cache = new WeakMap();
    const _stringify = (obj, prefix) => {
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
exports.stringifyObj = stringifyObj;
