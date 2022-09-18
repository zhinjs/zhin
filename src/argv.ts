import {Client} from "icqq";
import {DiscussMessageEvent, GroupMessageEvent, PrivateMessageEvent} from "icqq/lib/events";
import {TriggerEventMap} from "@/command";

export interface Argv<T extends keyof TriggerEventMap=keyof TriggerEventMap,A extends any[] = any[], O = {}> {
    name:string//指令名称
    argv?:string[]
    client?:Client
    event:TriggerEventMap[T]
    cqCode?: string//原文
    args?: A//携带的args
    options?: O//携带的options
    error?: string//是否报错
}
export namespace Argv{
    export interface Domain {
        string: string
        number: number
        boolean: boolean
        text: string
        integer: number
        date: Date,
        qq:number
        object:Record<string, any>
        function:Function
    }
    type DomainType = keyof Domain

    type ParamType<S extends string, F>
        = S extends `${any}:${infer T}` ? T extends DomainType ? Domain[T] : F : F
    export type Replace<S extends string, X extends string, Y extends string>
        = S extends `${infer L}${X}${infer R}` ? `${L}${Y}${Replace<R, X, Y>}` : S
    type ExtractAll<S extends string, F>
        = S extends `${infer L}]${infer R}` ? [ParamType<L, F>, ...ExtractAll<R, F>] : []
    export type ExtractFirst<S extends string, F>
        = S extends `${infer L}]${any}` ? ParamType<L, F> : boolean
    type ExtractSpread<S extends string> = S extends `${infer L}...${infer R}`
        ? [...ExtractAll<L, string>, ...ExtractFirst<R, string>[]]
        : [...ExtractAll<S, string>, ...string[]]
    export type ArgumentType<S extends string> = ExtractSpread<Replace<S, '>', ']'>>
    export type Type = DomainType | RegExp | string[] | Transform<any>
    export interface Declaration {
        name?: string
        type?: Type
        initial?: any
        variadic?: boolean
        required?: boolean
    }
    export type Transform<T> = (source: string) => T
    export interface DomainConfig<T> {
        transform?: Transform<T>
        greedy?: boolean
    }
    function resolveType(type: Type) {
        if (typeof type === 'function') {
            return type
        } else if (type instanceof RegExp) {
            return (source: string) => {
                if (type.test(source)) return source
                throw new Error()
            }
        } else if (Array.isArray(type)) {
            return (source: string) => {
                if (type.includes(source)) return source
                throw new Error()
            }
        }
        return typeTransformer[type]?.transform
    }
    const typeTransformer: Record<string, DomainConfig<any>> = {}
    export function createDomain<K extends keyof Domain>(name: K, transform: Transform<Domain[K]>, options?: DomainConfig<Domain[K]>) {
        typeTransformer[name] = { ...options, transform }
    }
    createDomain('string', source => source)
    createDomain('text', source => source, { greedy: true })
    createDomain('boolean', () => true)
    createDomain('number', (source) => {
        const value = +source
        if (Number.isFinite(value)) return value
        throw new Error('无效的数值')
    })
    createDomain('object',(source)=>{
        try {
            return JSON.parse(source)
        }catch {
            throw new Error('无效的对象')
        }
    })
    createDomain('function',(source)=>{
        try{
            return new Function(source)
        }catch {
            throw new Error('无效的函数')
        }
    })
    createDomain('integer', (source) => {
        const value = +source
        if (value * 0 === 0 && Math.floor(value) === value) return value
        throw new Error('无效的整数')
    })
    createDomain('qq',(source)=>{
        const atMsg = /\[CQ:at,type=at,qq=(\d+).*]/;
        if (atMsg.test(source)) {
            source=atMsg.exec(source)[1]
        }
        const value = +source
        if (value * 0 === 0 && Math.floor(value) === value) return value
        throw new Error('无效的用户qq')

    })
    createDomain('date', (source) => {
        const timestamp = new Date(source)
        if (+timestamp) return timestamp
        throw new Error('无效的日期')
    })
    const BRACKET_REGEXP = /<[^>]+>|\[[^\]]+\]/g
    interface DeclarationList extends Array<Declaration> {
        stripped: string
    }
    export function parse(content:string):Partial<Argv>{
        const message=content.split(' ')
        const name=message.shift()
        function mergeQuote(quote, list, start) {
            let end = list.slice(start).findIndex(str => str.endsWith(quote));
            end = end === -1 ? list.length : start + end + 1;
            const mergeList = message.slice(start, end);
            list.splice(start, end - start);
            let result:string=mergeList.join(' ')
            if(['"',"'"].includes(quote)){
                result=result.replace(new RegExp(`${quote}`, 'g'), '')
            }
            list.splice(start,0,result);
        }
        message.forEach((msg, start) => {
            if (msg.startsWith('"')) {
                mergeQuote('"', message, start);
            }
            if (msg.startsWith("'")) {
                mergeQuote("'", message, start);
            }
            if (msg.startsWith("$(")) {
                mergeQuote(")", message, start);
            }
            if(msg.startsWith('[CQ')){
                mergeQuote(']',message,start)
            }
        });
        return {
            name,
            argv:message.filter(Boolean),
            cqCode:content
        }
    }
    export function parseDecl(source: string) {
        let cap: RegExpExecArray
        const result = [] as DeclarationList
        while (cap = BRACKET_REGEXP.exec(source)) {
            let rawName = cap[0].slice(1, -1)
            let variadic = false
            if (rawName.startsWith('...')) {
                rawName = rawName.slice(3)
                variadic = true
            }
            const [name, rawType] = rawName.split(':')
            const type = rawType ? rawType.trim() as DomainType : undefined
            result.push({
                name,
                variadic,
                type,
                required: cap[0][0] === '<',
            })
        }
        result.stripped = source.replace(/:[\w-]+[>\]]/g, str => str.slice(-1)).trimEnd()
        return result
    }
    export function resolveConfig(type: Type) {
        return typeof type === 'string' ? typeTransformer[type] || {} : {}
    }
    export function parseValue(source: string, kind: string, argv: Argv, decl: Declaration = {}) {
        const { name, type, initial } = decl
        // no explicit parameter & has fallback
        const implicit = source === ''
        if (implicit && initial !== undefined) return initial
        // apply domain callback
        const transform = resolveType(type)
        if (transform) {
            try {
                return transform(source)
            } catch (err) {
                const message = err['message'] || 'check-syntax'
                argv.error = `invalid-${kind}.(${name}):${message}(${source})`
                    .replace(/invalid-/g,'无效的')
                    .replace('argument.','参数')
                    .replace('option.','选项')
                return
            }
        }

        // default behavior
        if (implicit) return true
        const n = +source
        return n * 0 === 0 ? n : source
    }

    export interface OptionConfig<T extends Type = Type> {
        value?: any
        fallback?: any
        type?: T
        /** hide the option by default */
        hidden?: boolean
    }

    export interface TypedOptionConfig<T extends Type> extends OptionConfig<T> {
        type: T
    }

    export interface OptionDeclaration extends Declaration, OptionConfig {
        description?: string
        values?: Record<string, any>
    }

    export type OptionDeclarationMap = Record<string, OptionDeclaration>
}
