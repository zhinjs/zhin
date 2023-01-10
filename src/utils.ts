// 深合并
import {Dict, PackageJson} from "@/types";
import * as path from "path";
import * as fs from "fs";
import CallSite = NodeJS.CallSite;
import {networkInterfaces} from "os";

const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const lookup = new Uint8Array(256);

for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
}

export function arrayBufferToBase64(arrayBuffer: ArrayBuffer, mediaType: string = ''): string {
    const bytes = new Uint8Array(arrayBuffer);
    const len = bytes.length;

    let base64 = (mediaType) ? 'data:' + mediaType + ';base64,' : '';

    for (let i = 0; i < len; i += 3) {
        base64 += chars[bytes[i] >> 2];
        base64 += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
        base64 += chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
        base64 += chars[bytes[i + 2] & 63];
    }

    if ((len % 3) === 2) {
        base64 = base64.substring(0, base64.length - 1) + '=';
    } else if (len % 3 === 1) {
        base64 = base64.substring(0, base64.length - 2) + '==';
    }

    return base64;
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
    base64 = base64.substring(base64.indexOf(',') + 1);

    const len = base64.length;
    let bufferLength = len * 0.75;
    let p = 0;
    let encoded1;
    let encoded2;
    let encoded3;
    let encoded4;

    if (base64[len - 1] === '=') {
        bufferLength--;

        if (base64[len - 2] === '=') {
            bufferLength--;
        }
    }

    const arrayBuffer = new ArrayBuffer(bufferLength);
    const bytes = new Uint8Array(arrayBuffer);

    for (let i = 0; i < len; i += 4) {
        encoded1 = lookup[base64.charCodeAt(i)];
        encoded2 = lookup[base64.charCodeAt(i + 1)];
        encoded3 = lookup[base64.charCodeAt(i + 2)];
        encoded4 = lookup[base64.charCodeAt(i + 3)];

        bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
        bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
        bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
    }

    return arrayBuffer;
}

export function deepMerge(base, ...from) {
    if (base === null || base === undefined) base = from.shift()
    if (from.length === 0) {
        return base;
    }
    if (typeof base !== 'object') {
        return base;
    }
    if (Array.isArray(base)) {
        return Array.from(new Set(base.concat(...from)));
    }
    for (const item of from) {
        for (const key in item) {
            if (base.hasOwnProperty(key)) {
                if (typeof base[key] === 'object') {
                    base[key] = deepMerge(base[key], item[key]);
                } else {
                    base[key] = item[key];
                }
            } else {
                base[key] = item[key];
            }
        }
    }
    return base;
}

// 深拷贝
export function deepClone(obj, cache = new WeakMap()) {
    if (obj === null) return obj
    if (obj instanceof Date) return new Date(obj)
    if (obj instanceof RegExp) return new RegExp(obj)
    if (typeof obj !== 'object') return obj
    if (cache.get(obj)) return cache.get(obj)
    //判断拷贝的obj是对象还是数组
    if (Array.isArray(obj))
        return obj.map((item) => deepClone(item, cache));
    const objClone = {};
    cache.set(obj, objClone)
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            if (obj[key] && typeof obj[key] === "object") {
                objClone[key] = deepClone(obj[key], cache);
            } else {
                objClone[key] = obj[key];
            }
        }
    }
    return objClone;
}

export function pick<T extends object, K extends keyof T>(source: T, keys?: Iterable<K>, forced?: boolean) {
    if (!keys) return {...source}
    const result = {} as Pick<T, K>
    for (const key of keys) {
        if (forced || key in source) result[key] = source[key]
    }
    return result
}

export function omit<T, K extends keyof T>(source: T, keys?: Iterable<K>) {
    if (!keys) return {...source}
    const result = {...source} as Omit<T, K>
    for (const key of keys) {
        Reflect.deleteProperty(result, key)
    }
    return result
}
export function getPackageInfo(filepath:string){
    const fileDir = path.dirname(filepath)
    if (fs.existsSync(path.resolve(fileDir, '../package.json'))) {
        const {name: fullName, ...packageJson} = require(path.join(fileDir, '../package.json')) as PackageJson
        return Object.assign(packageJson,{fullName})
    } else if (fs.existsSync(path.resolve(fileDir, 'package.json'))) {
        const {name: fullName, ...packageJson} = require(path.resolve(fileDir, 'package.json')) as PackageJson
        return Object.assign(packageJson,{fullName})
    }
    return null
}
export function wrapExport(filepath: string) {
    const {default: result, ...other} = require(filepath)
    return Object.assign(typeof result==="function"?{
        install:result
    }:result||{}, other)
}

export function getIpAddress(){
    const interfaces=networkInterfaces()
    const ips:string[]=[]
    for (let dev in interfaces) {
        for (let j = 0; j < interfaces[dev].length; j++) {
            if (interfaces[dev][j].family === 'IPv4') {
                ips.push(interfaces[dev][j].address);
            }
        }
    }
    if(!ips.length)ips.push('127.0.0.1')
    return ips
}
export function getCaller(){
    const origPrepareStackTrace = Error.prepareStackTrace
    Error.prepareStackTrace = function (_, stack) {
        return stack
    }
    const err = new Error()
    const stack:CallSite[] = err.stack as unknown as CallSite[]
    Error.prepareStackTrace = origPrepareStackTrace
    stack.shift()
    stack.shift()
    return stack.shift()
}
export function deepEqual<T = object>(a: Partial<T>, b: Partial<T>):boolean {
    if (a === b) return true
    if (typeof a !== typeof b) return false
    if (typeof a !== 'object') return false
    if (!a || !b) return false
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false
        return a.every((item, index) => deepEqual(item, b[index]))
    } else if (Array.isArray(b)) {
        return false
    }
    return Object.keys({...a, ...b}).every(key => deepEqual(a[key], b[key]))
}
function deepen(modifyString: (source: string) => string) {
    function modifyObject<T extends unknown>(source: T): T {
        if (typeof source !== 'object' || !source) return source
        if (Array.isArray(source)) return source.map(modifyObject) as any
        const result = {} as any
        for (const key in source) {
            result[modifyString(key)] = modifyObject(source[key])
        }
        return result as T
    }

    return function <T>(source: T): T {
        if (typeof source === 'string') {
            return modifyString(source) as any
        } else {
            return modifyObject(source)
        }
    }
}

export const camelCase = deepen(source => source.replace(/[_-][a-z]/g, str => str.slice(1).toUpperCase()))
export const paramCase = deepen(source => source.replace(/_/g, '-').replace(/(?<!^)[A-Z]/g, str => '-' + str.toLowerCase()))
export const snakeCase = deepen(source => source.replace(/-/g, '_').replace(/(?<!^)[A-Z]/g, str => '_' + str.toLowerCase()))

export const camelize = camelCase
export const hyphenate = paramCase

export function capitalize(source: string) {
    return source.charAt(0).toUpperCase() + source.slice(1)
}

// eslint-disable-next-line no-new-func
export const interpolate = new Function('template', 'context', 'pattern', `
  return template.replace(pattern || /\\{\\{([\\s\\S]+?)\\}\\}/g, (_, expr) => {
    try {
      with (context) {
        const result = eval(expr)
        return result === undefined ? '' : result
      }
    } catch {
      return ''
    }
  })
`) as ((template: string, context: object, pattern?: RegExp) => string)

export function escapeRegExp(source: string) {
    return source
        .replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
        .replace(/-/g, '\\x2d')
}

export function trimSlash(source: string) {
    return source.replace(/\/$/, '')
}

export function sanitize(source: string) {
    if (!source.startsWith('/')) source = '/' + source
    return trimSlash(source)
}

export function toJSON(cls: object): Dict {
    function getProperty(new_obj) {
        if (new_obj.__proto__ === null) { //说明该对象已经是最顶层的对象
            return [];
        }
        return [...Object.getOwnPropertyNames(new_obj), ...getProperty(new_obj.__proto__)];
    }

    const {info = {}, ...obj} = Object.fromEntries(getProperty(cls).filter(key => {
        return typeof cls[key] !== 'function' && !key.startsWith('_') && !['c', 'client'].includes(key)
    }).map(key => {
        return [key, cls[key]]
    }))
    return {...obj, ...info}
}

export function template(path: string | string[], ...params: any[]) {
    path = [].concat(path)
    for (const item of path) {
        const source = template.get(item)
        if (typeof source === 'string') {
            return template.format(source, ...params)
        }
    }
    return path[0]
}

function deepAssign(head: any, base: any): any {
    Object.entries(base).forEach(([key, value]) => {
        if (typeof value === 'object' && typeof head[key] === 'object') {
            head[key] = deepAssign(head[key], value)
        } else {
            head[key] = base[key]
        }
    })
    return head
}

export namespace template {
    export type Node = string | Store

    export interface Store {
        [K: string]: Node
    }

    const store: Store = {}

    export function set(path: string, value: Node) {
        const seg = path.split('.')
        let node: Node = store
        while (seg.length > 1) {
            node = node[seg.shift()] ||= {}
        }
        deepAssign(node, {[seg[0]]: value})
    }

    export function get(path: string) {
        const seg = path.split('.')
        let node: Node = store
        do {
            node = node[seg.shift()]
        } while (seg.length && node)
        if (typeof node === 'string') return node
    }

    export function format(source: string, ...params: any[]) {
        if (params[0] && typeof params[0] === 'object') {
            source = interpolate(source, params[0])
        }
        let result = ''
        let cap: RegExpExecArray
        // eslint-disable-next-line no-cond-assign
        while (cap = /\{(\w+)\}/.exec(source)) {
            result += source.slice(0, cap.index) + (cap[1] in params ? params[cap[1]] : '')
            source = source.slice(cap.index + cap[0].length)
        }
        return result + source
    }

    export function quote(content: any) {
        return get('basic.left-quote') + content + get('basic.right-quote')
    }

    export function brace(items: any[]) {
        if (!items.length) return ''
        return get('basic.left-brace') + items.join(get('basic.comma')) + get('basic.right-brace')
    }
}

export {template as t}

/* eslint-disable quote-props */
template.set('basic', {
    'left-brace': '（',
    'right-brace': '）',
    'left-quote': '“',
    'right-quote': '”',
    'comma': '，',
    'and': '和',
    'or': '或',
})

export function noop() {
}

export namespace Time {
    export const millisecond = 1
    export const second = 1000
    export const minute = second * 60
    export const hour = minute * 60
    export const day = hour * 24
    export const week = day * 7

    let timezoneOffset = new Date().getTimezoneOffset()

    export function setTimezoneOffset(offset: number) {
        timezoneOffset = offset
    }

    export function getTimezoneOffset() {
        return timezoneOffset
    }

    export function getDateNumber(date: number | Date = new Date(), offset?: number) {
        if (typeof date === 'number') date = new Date(date)
        if (offset === undefined) offset = timezoneOffset
        return Math.floor((date.valueOf() / minute - offset) / 1440)
    }

    export function fromDateNumber(value: number, offset?: number) {
        const date = new Date(value * day)
        if (offset === undefined) offset = timezoneOffset
        return new Date(+date + offset * minute)
    }

    const numeric = /\d+(?:\.\d+)?/.source
    const timeRegExp = new RegExp(`^${[
        'w(?:eek(?:s)?)?',
        'd(?:ay(?:s)?)?',
        'h(?:our(?:s)?)?',
        'm(?:in(?:ute)?(?:s)?)?',
        's(?:ec(?:ond)?(?:s)?)?',
    ].map(unit => `(${numeric}${unit})?`).join('')}$`)

    export function parseTime(source: string) {
        const capture = timeRegExp.exec(source)
        if (!capture) return 0
        return (parseFloat(capture[1]) * week || 0)
            + (parseFloat(capture[2]) * day || 0)
            + (parseFloat(capture[3]) * hour || 0)
            + (parseFloat(capture[4]) * minute || 0)
            + (parseFloat(capture[5]) * second || 0)
    }

    export function parseDate(date: string) {
        const parsed = parseTime(date)
        if (parsed) {
            date = Date.now() + parsed as any
        } else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) {
            date = `${new Date().toLocaleDateString()}-${date}`
        } else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) {
            date = `${new Date().getFullYear()}-${date}`
        }
        return date ? new Date(date) : new Date()
    }

    export function formatTimeShort(ms: number) {
        const abs = Math.abs(ms)
        if (abs >= day - hour / 2) {
            return Math.round(ms / day) + 'd'
        } else if (abs >= hour - minute / 2) {
            return Math.round(ms / hour) + 'h'
        } else if (abs >= minute - second / 2) {
            return Math.round(ms / minute) + 'm'
        } else if (abs >= second) {
            return Math.round(ms / second) + 's'
        }
        return ms + 'ms'
    }

    export function formatTime(ms: number) {
        let result: string
        if (ms >= day - hour / 2) {
            ms += hour / 2
            result = Math.floor(ms / day) + ' 天'
            if (ms % day > hour) {
                result += ` ${Math.floor(ms % day / hour)} 小时`
            }
        } else if (ms >= hour - minute / 2) {
            ms += minute / 2
            result = Math.floor(ms / hour) + ' 小时'
            if (ms % hour > minute) {
                result += ` ${Math.floor(ms % hour / minute)} 分钟`
            }
        } else if (ms >= minute - second / 2) {
            ms += second / 2
            result = Math.floor(ms / minute) + ' 分钟'
            if (ms % minute > second) {
                result += ` ${Math.floor(ms % minute / second)} 秒`
            }
        } else {
            result = Math.round(ms / second) + ' 秒'
        }
        return result
    }

    const dayMap = ['日', '一', '二', '三', '四', '五', '六']

    function toDigits(source: number, length = 2) {
        return source.toString().padStart(length, '0')
    }

    export function template(template: string, time = new Date()) {
        return template
            .replace('yyyy', time.getFullYear().toString())
            .replace('yy', time.getFullYear().toString().slice(2))
            .replace('MM', toDigits(time.getMonth() + 1))
            .replace('dd', toDigits(time.getDate()))
            .replace('hh', toDigits(time.getHours()))
            .replace('mm', toDigits(time.getMinutes()))
            .replace('ss', toDigits(time.getSeconds()))
            .replace('SSS', toDigits(time.getMilliseconds(), 3))
    }

    function toHourMinute(time: Date) {
        return `${toDigits(time.getHours())}:${toDigits(time.getMinutes())}`
    }

    export function formatTimeInterval(time: Date, interval?: number) {
        if (!interval) {
            return template('yyyy-MM-dd hh:mm:ss', time)
        } else if (interval === day) {
            return `每天 ${toHourMinute(time)}`
        } else if (interval === week) {
            return `每周${dayMap[time.getDay()]} ${toHourMinute(time)}`
        } else {
            return `${template('yyyy-MM-dd hh:mm:ss', time)} 起每隔 ${formatTime(interval)}`
        }
    }
}

/**
 * random operations
 */
export class Random {
    constructor(private value = Math.random()) {
    }

    bool(probability: number) {
        if (probability >= 1) return true
        if (probability <= 0) return false
        return this.value < probability
    }

    /**
     * random real
     * @param start start number
     * @param end end number
     * @returns a random real in the interval [start, end)
     */
    real(end: number): number
    real(start: number, end: number): number
    real(...args: [number, number?]): number {
        const start = args.length > 1 ? args[0] : 0
        const end = args[args.length - 1]
        return this.value * (end - start) + start
    }

    /**
     * random integer
     * @param start start number
     * @param end end number
     * @returns a random integer in the interval [start, end)
     */
    int(end: number): number
    int(start: number, end: number): number
    int(...args: [number, number?]): number {
        return Math.floor(this.real(...args))
    }

    pick<T>(source: readonly T[]) {
        return source[Math.floor(this.value * source.length)]
    }

    splice<T>(source: T[]) {
        return source.splice(Math.floor(this.value * source.length), 1)[0]
    }

    weightedPick<T extends string>(weights: Readonly<Record<T, number>>): T {
        const total = Object.entries(weights).reduce((prev, [, curr]) => prev + (curr as number), 0)
        const pointer = this.value * total
        let counter = 0
        for (const key in weights) {
            counter += weights[key]
            if (pointer < counter) return key
        }
    }
}

export namespace Random {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

    export function id(length = 8, radix = 16) {
        let result = ''
        for (let i = 0; i < length; ++i) {
            result += chars[Math.floor(Math.random() * radix)]
        }
        return result
    }

    /**
     * random real
     * @param start start number
     * @param end end number
     * @returns a random real in the interval [start, end)
     */
    export function real(end: number): number
    export function real(start: number, end: number): number
    export function real(...args: [number, number?]): number {
        return new Random().real(...args)
    }

    /**
     * random integer
     * @param start start number
     * @param end end number
     * @returns a random integer in the interval [start, end)
     */
    export function int(end: number): number
    export function int(start: number, end: number): number
    export function int(...args: [number, number?]): number {
        return new Random().int(...args)
    }

    export function pick<T>(source: readonly T[]) {
        return new Random().pick(source)
    }

    export function shuffle<T>(source: readonly T[]) {
        const clone = source.slice()
        const result: T[] = []
        for (let i = source.length; i > 0; --i) {
            result.push(new Random().splice(clone))
        }
        return result
    }

    export function multiPick<T>(source: T[], count: number) {
        source = source.slice()
        const result: T[] = []
        const length = Math.min(source.length, count)
        for (let i = 0; i < length; i += 1) {
            const index = Math.floor(Math.random() * source.length)
            const [item] = source.splice(index, 1)
            result.push(item)
        }
        return result
    }

    export function weightedPick<T extends string>(weights: Readonly<Record<T, number>>): T {
        return new Random().weightedPick(weights)
    }

    export function bool(probability: number) {
        return new Random().bool(probability)
    }
}

export async function sleep(timeout) {
    return new Promise(resolve => setTimeout(resolve, timeout))
}

export function isNullable(value: any) {
    return value === null || value === undefined
}

export function isBailed(value: any) {
    return value !== null && value !== false && value !== undefined
}

export function remove<T>(list: T[], value: T) {
    const idx = list.indexOf(value)
    if (idx >= 0) {
        list.splice(idx, 1)
    }
}

export function makeArray<T>(source: T | T[]) {
    return Array.isArray(source) ? source : isNullable(source) ? [] : [source]
}

export function valueMap<T, U>(object: Dict<T>, transform: (value: T, key: string) => U): Dict<U> {
    return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]))
}

export function defineProperty<T, K extends keyof T>(object: T, key: K, value: T[K]): void
export function defineProperty<T, K extends keyof any>(object: T, key: K, value: any): void
export function defineProperty<T, K extends keyof any>(object: T, key: K, value: any) {
    Object.defineProperty(object, key, {writable: true, value})
}

