import {TriggerEventMap} from "@/command";
import {Bot, SegmentElem} from "@/bot";
import {Session} from "@/session";

export interface Argv<T extends keyof TriggerEventMap=keyof TriggerEventMap,A extends any[] = any[], O = {}> {
    name?:string//指令名称
    argv?:SegmentElem[][]
    session:Session
    bot?:Bot
    segments?: SegmentElem[]//原文
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
        regexp:RegExp
        qq:number
        object:Record<string, any>
        array:any[]
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
    export type Transform<T> = (source: SegmentElem[]) => T
    export interface DomainConfig<T> {
        transform?: Transform<T>
        greedy?: boolean
    }
    function resolveType(type: Type) {
        if (typeof type === 'function') {
            return type
        } else if (type instanceof RegExp) {
            return (source: SegmentElem[]) => {
                if (source.every(s=>s.type==='text') && source.map(s=>s.data['text']).join('').match(type)) return source
                throw new Error()
            }
        } else if (Array.isArray(type)) {
            return (source: SegmentElem[]) => {
                if (type.includes(source.map(s=>s.data['text']).join(''))) return source
                throw new Error()
            }
        }
        return typeTransformer[type]?.transform
    }
    const typeTransformer: Record<string, DomainConfig<any>> = {}
    export function createDomain<K extends keyof Domain>(name: K, transform: Transform<Domain[K]>, options?: DomainConfig<Domain[K]>) {
        typeTransformer[name] = { ...options, transform }
    }
    createDomain('string', source => source.map(s=>s.data['text']).join(''))
    createDomain('text', source => source.map(s=>s.data['text']).join(''), { greedy: true })
    createDomain('boolean', () => true)
    createDomain('number', (source) => {
        const value = +source[0].data['text']
        if (Number.isFinite(value)) return value
        throw new Error('无效的数值')
    })
    createDomain('integer', (source) => {
        const value = +source[0].data['text']
        if (value * 0 === 0 && Math.floor(value) === value) return value
        throw new Error('无效的整数')
    })
    createDomain('qq',(source)=>{
        if (source[0].type==='mention') return source[0].data['user_id']
        throw new Error('无效的用户qq')

    })
    const BRACKET_REGEXP = /<[^>]+>|\[[^\]]+\]/g
    interface DeclarationList extends Array<Declaration> {
        stripped: string
    }
    export function parse(content:SegmentElem[]):Partial<Argv>{
        let argv:SegmentElem[][]=[]
        content.forEach(segment=>{
            let argvItem:SegmentElem[]=[]
            if(segment.type!=='text') argvItem.push(segment)
            else segment.data['text'].split(' ').forEach(text=>{
                argvItem.push({
                    type:'text',
                    data:{text}
                })
                argv.push([...argvItem])
                argvItem=[]
            })
        })
        const first=argv.shift()[0]
        return {
            name:first.data['text']||'',
            argv,
            segments:content
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
    export function parseValue(source: SegmentElem[], kind: string, argv: Argv, decl: Declaration = {}) {
        const { name, type, initial } = decl
        // no explicit parameter & has fallback
        const implicit = source.length===1&& source[0].type==='text' && source[0].data['text']===''
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
