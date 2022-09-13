
// 深合并
import {Dict} from "@/types";

export function remove<T>(list: T[], item: T) {
    const index = list.indexOf(item)
    if (index >= 0) {
        list.splice(index, 1)
        return true
    }
}
export function deepMerge(base, ...from) {
    if (from.length === 0) {
        return base;
    }
    if (typeof base !== 'object') {
        return base;
    }
    if (Array.isArray(base)) {
        return base.concat(...from);
    }
    for (const item of from) {
        for (const key in item) {
            if (base.hasOwnProperty(key)) {
                if (typeof base[key] === 'object') {
                    base[key] = deepMerge(base[key], item[key]);
                }
                else {
                    base[key] = item[key];
                }
            }
            else {
                base[key] = item[key];
            }
        }
    }
    return base;
}
// 深拷贝
export function deepClone(obj) {
    if (typeof obj !== 'object')
        return obj;
    if (!obj)
        return obj;
    //判断拷贝的obj是对象还是数组
    if (Array.isArray(obj))
        return obj.map((item) => deepClone(item));
    const objClone = {};
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            if (obj[key] && typeof obj[key] === "object") {
                objClone[key] = deepClone(obj[key]);
            }
            else {
                objClone[key] = obj[key];
            }
        }
    }
    return objClone;
}
export function pick<T, K extends keyof T>(source: T, keys?: Iterable<K>, forced?: boolean) {
    if (!keys) return { ...source }
    const result = {} as Pick<T, K>
    for (const key of keys) {
        if (forced || key in source) result[key] = source[key]
    }
    return result
}

export function omit<T, K extends keyof T>(source: T, keys?: Iterable<K>) {
    if (!keys) return { ...source }
    const result = { ...source } as Omit<T, K>
    for (const key of keys) {
        Reflect.deleteProperty(result, key)
    }
    return result
}
export function wrapExport(filepath:string){
    const {default:result,...other}=require(filepath)
    return result?Object.assign(result,other):other
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

    return function<T> (source: T): T {
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

export function template(path: string | string[], ...params: any[]) {
    path=[].concat(path)
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
        deepAssign(node, { [seg[0]]: value })
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

export { template as t }

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
export function noop(){}
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
}/**
 * random operations
 */
export class Random {
    constructor(private value = Math.random()) {}

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

export async function sleep(timeout){
    return new Promise(resolve => setTimeout(resolve,timeout))
}

export function isNullable(value: any) {
    return value === null || value === undefined
}
export function isBailed(value: any) {
    return value !== null && value !== false && value !== undefined
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
    Object.defineProperty(object, key, { writable: true, value })
}

