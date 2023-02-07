import {Bot} from "./bot";
import {Session} from "./session";
import Element from "@/element";
import {TriggerSessionMap} from "./command";
import {Zhin} from "./zhin";

export interface Argv<A extends any[] = any[], O = {},T extends keyof TriggerSessionMap=keyof TriggerSessionMap> {
    name?:string//指令名称
    argv?:Element[][]
    session:TriggerSessionMap[T]
    atMe?:boolean
    bot?:Bot<keyof Zhin.Bots,any,any>
    segments?: Element[]//原文
    args?: A//携带的args
    options?: O//携带的options
    error?: string//是否报错
}


export namespace Argv{
    export interface Domain {
        any: Element[]
        text:string
        string: string
        mention: Element
        face: Element
        file: Element
        voice: Element
        audio: Element
        image: Element
        number: number
        boolean: boolean
        integer: number
        date: Date,
        regexp:RegExp
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
        ? [...ExtractAll<L, Element[]>, ...ExtractFirst<R, Element[]>[]]
        : [...ExtractAll<S, Element[]>, ...Element[]]
    export type ArgumentType<S extends string> = ExtractSpread<Replace<S, '>', ']'>>
    export type Type = DomainType | RegExp | Element[] | Transform<any>
    export interface Declaration {
        name?: string
        type?: Type
        initial?: any
        variadic?: boolean
        required?: boolean
    }
    export type Transform<T> = (source: Element[]) => T
    export interface DomainConfig<T> {
        transform?: Transform<T>
        greedy?: boolean
    }
    function resolveType(type: Type) {
        if (typeof type === 'function') {
            return type
        } else if (type instanceof RegExp) {
            return (source: Element[]) => {
                if (source.every(s=>s.type==='text') && source.map(s=>s.attrs.text).join('').match(type)) return source
                throw new Error()
            }
        } else if (Array.isArray(type)) {
            return (source: Element[]) => {
                return source
            }
        }
        return typeTransformer[type]?.transform
    }
    const typeTransformer: Record<string, DomainConfig<any>> = {}
    export function createDomain<K extends keyof Domain>(name: K, transform: Transform<Domain[K]>, options?: DomainConfig<Domain[K]>) {
        typeTransformer[name] = { ...options, transform }
    }
    createDomain('any', source => source, { greedy: true })
    createDomain('string', (source) => {
        const textElem=source.find(s=>s.type==='text')
        if(textElem) return textElem.attrs.text
        throw new Error('无效的文本')
    })
    createDomain('text', (source) => {
        let result:string=''
        for(const elem of source){
            if(elem.type==='text'){
                result+=elem.attrs.text
            }else{
                break;
            }
        }
        return result
    })
    createDomain('boolean', () => true)
    createDomain('mention', (source) => {
        const elem=source.find(s=>s.type==='mention')
        if(elem) return elem
        throw new Error('无效的用户qq')
    })
    createDomain('face', (source) => {
        const elem=source.find(s=>s.type==='face' || (s.type==='image' && s.attrs['asface']))
        if(elem) return elem
        throw new Error('无效的表情对象')
    })
    createDomain('file', (source) => {
        const elem=source.find(s=>s.type==='file')
        if(elem) return elem
        throw new Error('无效的文件')
    })
    createDomain('image', (source) => {
        const elem=source.find(s=>s.type==='image')
        if(elem) return elem
        throw new Error('无效的图片')
    })
    createDomain('voice', (source) => {
        const elem=source.find(s=>s.type==='voice')
        if(elem) return elem
        throw new Error('无效的音频')
    })
    createDomain('audio', (source) => {
        const elem=source.find(s=>s.type==='audio')
        if(elem) return elem
        throw new Error('无效的语音')
    })
    createDomain('number', (source) => {
        const value = +source[0].attrs.text
        if (Number.isFinite(value)) return value
        throw new Error('无效的数值')
    })
    createDomain('integer', (source) => {
        const value = +source[0].attrs.text
        if (value * 0 === 0 && Math.floor(value) === value) return value
        throw new Error('无效的整数')
    })
    const BRACKET_REGEXP = /<[^>]+>|\[[^\]]+\]/g
    interface DeclarationList extends Array<Declaration> {
        stripped: string
    }
    export function parse<P extends keyof Zhin.Adapters,E extends keyof Zhin.BotEventMaps[P]>(content:Element[],session:Session<P,E>):Argv|void{
        let argv:Element[][]=[]
        const atMe=session.isAtMe();
        const saveSession=session.elements===content
        let argvItem:Element[]=[]
        for(const segment of content){
            const idx=content.indexOf(segment)
            if(idx===0 && segment.type==='text'){
                if(session.bot.options.prefix && (segment.type!=='text' || !segment.attrs.text.startsWith(session.bot.options.prefix)) && saveSession && !atMe){
                    return
                }else if(atMe && saveSession){
                    continue
                }else if(saveSession){
                    segment.attrs.text=segment.attrs.text.replace(session.bot.options.prefix,'')
                }
            }else if(atMe && idx===1 && segment.type==='text' && saveSession){
                segment.attrs.text=segment.attrs.text.trim()
            }
            if(segment.type!=='text') argvItem.push(segment)
            else {
                // 结束引号标识
                let quoteEnd=''
                segment.attrs.text.split(' ').forEach(text=>{
                    // 处理文本
                    if(/^'|"|“|‘.+$/.test(text) && !quoteEnd) {
                        if(text.startsWith('“')){
                            quoteEnd='”'
                        }else if(text.startsWith('‘')){
                            quoteEnd='’'
                        }else{
                            quoteEnd=text[0]
                        }
                    }
                    const element=Element('text',{text})
                    element.parent=segment.parent
                    argvItem.push(element)
                    if(/'|"|”|’$/.test(text) && quoteEnd && quoteEnd===text[text.length-1]){
                        quoteEnd=''
                    }
                    if(!quoteEnd){
                        argv.push([...argvItem])
                        argvItem=[]
                    }else{
                        const element=Element('text',{text:' '})
                        element.parent=segment.parent
                        argvItem.push(element)
                    }
                })
            }
        }
        if(argvItem.length) argv.push([...argvItem])
        argv=argv.filter(sArr=>{
            return sArr.filter(s=>{
                return s.type !=="text" || !!s.attrs.text?.length
            }).length
        }).map(sArr=>{
            if(sArr.every(s=>s.type==='text')) return [Element('text',{text:sArr.map(s=>s.attrs.text).join('')})]
            return sArr
        })
        const first=argv.length?argv.shift()[0]:Element('text',{text:''})
        return {
            name:first.attrs.text||'',
            bot:session.bot,
            atMe,
            session:session as any,
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
    export function parseValue(source: Element[], kind: string, argv: Argv, decl: Declaration = {}) {
        const { name, type, initial } = decl
        const implicit = source.length===1&& source[0].type==='text' && source[0].attrs.text===''
        if (implicit && initial !== undefined) return initial
        const transform = resolveType(type)
        if (transform) {
            try {
                return transform(source)
            } catch (err) {
                const message = err['message'] || 'check-syntax'
                argv.error = `invalid-${kind}.(${name}):${message}(${JSON.stringify(source)})`
                    .replace(/invalid-/g,'无效的')
                    .replace('argument.','参数')
                    .replace('option.','选项')
                return
            }
        }
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
