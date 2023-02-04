import {arrayBufferToBase64, evaluate, is, isNullable, makeArray} from "./utils";
import {Awaitable, Dict} from "./types";
import {Fragment} from "./element";

interface Element {
    [Element.key]: true
    type: string
    attrs: Dict
    children: (Element)[]
    source?: string

    toString(strip?: boolean): string
}

function toElement(content: any) {
    if (Element.isElement(content)) {
        return content
    }
    if(Array.isArray(content)){
        return Element('text', {text:`[${content.join()}]`})
    }
    return Element('text', {text:content.toString()})
}

function toElementArray(content: Element.Fragment):(Element)[] {
    if (Array.isArray(content)) {
        return content.map(toElement).filter(x => x)
    } else {
        return [toElement(content)].filter(x => x)
    }
}

interface ElementConstructor extends Element {

}

class ElementConstructor {
    name: string = 'Element';

    toString(strip = false) {
        if (this.type === 'text') return Element.escape(this.attrs.text)
        const inner = this.children.map(child => child.toString(strip)).join('')
        if (strip) return inner
        const attrs = Object.entries(this.attrs).map(([key, value]) => {
            if (isNullable(value)) return ''
            if (value === true) return ` ${key}`
            if (value === false) return ` no-${key}`
            return ` ${key}="${Element.escape('' + value, true)}"`
        }).join('')
        if (!this.children.length) return `<${this.type}${attrs}/>`
        return `<${this.type}${attrs}>${inner}</${this.type}>`
    }
}

function Element(type: string, ...children: Element.Fragment[]): Element
function Element(type: string, attrs: Dict, ...children: Element.Fragment[]): Element
function Element(type: string, ...args: any[]) {
    const el = Object.create(ElementConstructor.prototype)
    el[Element.key] = true
    let attrs: Dict = {}, children: Fragment[] = []
    if (args[0] && typeof args[0] === 'object' && !Element.isElement(args[0]) && !Array.isArray(args[0])) {
        const props = args.shift()
        for (const [key, value] of Object.entries(props)) {
            if (isNullable(value)) continue
            if (key === 'children') {
                args.push(...makeArray(value))
            } else {
                attrs[key] = value
            }
        }
    }
    for (const child of args) {
        children.push(...toElementArray(child))
    }
    return Object.assign(el, {type, attrs, children})
}

namespace Element {
    export const key = Symbol('zhinElement')

    export function isElement(source: any): source is Element {
        return source && typeof source === 'object' && source[Element.key]
    }

    export const Fragment = 'template'
    export type Render<S,A extends Dict=Dict,T=Fragment> = (attrs: A, children: Element[], session: S) => T
    export type Transformer<S = never> = boolean | Fragment | Render<S,Dict,boolean | Fragment>
    export type AsyncTransformer<S = never> = boolean | Fragment | Render<S,Dict,Awaitable<boolean | Fragment>>

    export type Fragment = string|number|boolean | Element | (string|number|boolean | Element)[]

    export function normalize(source: Fragment, context?: any) {
        if (typeof source !== 'string') return toElementArray(source)
        return Element.parse(source, context)
    }

    export function escape(source: string, inline = false) {
        const result = source
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
        return inline
            ? result.replace(/"/g, '&quot;')
            : result
    }

    export function unescape(source: string) {
        return source
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#(\d+);/g, (_, code) => code === '38' ? _ : String.fromCharCode(+code))
            .replace(/&#x([0-9a-f]+);/gi, (_, code) => code === '26' ? _ : String.fromCharCode(parseInt(code, 16)))
            .replace(/&(amp|#38|#x26);/g, '&')
    }

    const tagRegExp = /<!--[\s\S]*?-->|<(\/?)([^!\s>/]*)([^>]*?)\s*(\/?)>/
    const attrRegExp = /([^\s=]+)(?:="([^"]*)"|='([^']*)')?/g
    const interpRegExp = /\{\{([^{}]*)\}\}/

    interface Token {
        type: string
        close: string
        empty: string
        attrs: Dict
        source: string
    }

    type Combinator = ' ' | '>' | '+' | '~'

    export interface Selector {
        type: string
        combinator: Combinator
    }

    const combRegExp = / *([ >+~]) */g

    export function parseSelector(input: string): Selector[][] {
        return input.split(',').map((query) => {
            const selectors: Selector[] = []
            query = query.trim()
            let combCap: RegExpExecArray, combinator: Combinator = ' '
            while ((combCap = combRegExp.exec(query))) {
                selectors.push({type: query.slice(0, combCap.index), combinator})
                combinator = combCap[1] as Combinator
                query = query.slice(combCap.index + combCap[0].length)
            }
            selectors.push({type: query, combinator})
            return selectors
        })
    }

    export function select(source: string | Element[], query: string | Selector[][]): Element[] {
        if (typeof source === 'string') source = parse(source)
        if (typeof query === 'string') query = parseSelector(query)
        if (!query.length) return
        let adjacent: Selector[][] = []
        const results: Element[] = []
        for (const [index, element] of source.entries()) {
            const inner: Selector[][] = []
            const local = [...query, ...adjacent]
            adjacent = []
            let matched = false
            for (const group of local) {
                const {type, combinator} = group[0]
                if (type === element.type || type === '*') {
                    if (group.length === 1) {
                        matched = true
                    } else if ([' ', '>'].includes(group[1].combinator)) {
                        inner.push(group.slice(1))
                    } else if (group[1].combinator === '+') {
                        adjacent.push(group.slice(1))
                    } else {
                        query.push(group.slice(1))
                    }
                }
                if (combinator === ' ') {
                    inner.push(group)
                }
            }
            if (matched) results.push(source[index])
            results.push(...select(element.children, inner))
        }
        return results
    }
    export function parse<S>(source: string, context?: S) {
        const tokens: (Element | Token)[] = []

        function pushText(content: string) {
            if (content) tokens.push(Element('text', {text:content}))
        }
        let tagCap: RegExpExecArray
        while ((tagCap = tagRegExp.exec(source))) {
            parseContent(source.slice(0, tagCap.index))
            const [_, close, type, attrs, empty] = tagCap
            source = source.slice(tagCap.index + _.length)
            if (_.startsWith('<!')) continue
            const token: Token = {source: _, type: type || Fragment, close, empty, attrs: {}}
            let attrCap: RegExpExecArray
            while ((attrCap = attrRegExp.exec(attrs))) {
                let [_, key, v1, v2 = v1] = attrCap
                if (!isNullable(v2)) {
                    if(key.startsWith(':')){
                        token.attrs[key.slice(1)]=evaluate<S>(v2, context)
                    }else{
                        token.attrs[key] = unescape(v2)
                    }
                } else if (key.startsWith('no-')) {
                    token.attrs[key.slice(3)] = false
                } else {
                    token.attrs[key] = true
                }
            }
            tokens.push(token)
        }

        parseContent(source)

        function parseContent(source: string) {
            source = source
                .replace(/^\s*\n\s*/, '')
                .replace(/\s*\n\s*$/, '')
            if (context) {
                let interpCap: RegExpExecArray
                while ((interpCap = interpRegExp.exec(source))) {
                    const [_, expr] = interpCap
                    pushText(unescape(source.slice(0, interpCap.index)))
                    source = source.slice(interpCap.index + _.length)
                    const content = evaluate(expr, context)
                    tokens.push(...toElementArray(content))
                }
            }
            pushText(unescape(source))
        }
        const stack = [Element(Fragment)]

        function rollback(index: number) {
            for (; index > 0; index--) {
                const {children} = stack.shift()
                const {source} = stack[0].children.pop()
                stack[0].children.push(Element('text', {text: source}))
                stack[0].children.push(...children)
            }
        }
        for (const token of tokens) {
            if (isElement(token)) {
                stack[0].children.push(token)
            }else if (token.close) {
                let index = 0
                while (index < stack.length && stack[index].type !== token.type) index++
                if (index === stack.length) {
                    // no matching open tag
                    stack[0].children.push(Element('text', {text: token.source}))
                } else {
                    rollback(index)
                    const element = stack.shift()
                    delete element.source
                }
            } else {
                const element = Element(token.type, token.attrs)
                stack[0].children.push(element)
                if (!token.empty) {
                    element.source = token.source
                    stack.unshift(element)
                }
            }
        }
        rollback(stack.length - 1)
        return stack[0].children
    }
    export function stringify(fragment:Element.Fragment){
        if(!Array.isArray(fragment)) fragment=[fragment]
        return fragment.map((element)=>{
            if(typeof element==='string' || typeof element==='number'|| typeof element==='boolean') element=Element('text',{content:element})
            return element.toString()
        }).join('')
    }

    export function transform<S = never>(source: string, rules: Dict<Transformer<S>>, session?: S): string
    export function transform<S = never>(source: Element[], rules: Dict<Transformer<S>>, session?: S): Element[]
    export function transform<S>(source: string | Element[], rules: Dict<Transformer<S>>, session?: S) {
        const elements = typeof source === 'string' ? parse(source,session) : source
        const output: Fragment[] = []
        elements.forEach((element) => {
            const {type, attrs, children} = element
            let result = rules[type] ?? rules.default ?? true
            if (typeof result === 'function') {
                result = result(attrs, children, session)
            }
            if (result === true) {
                output.push(Element(type, attrs, transform(children, rules, session)))
            } else if (result !== false) {
                output.push(...normalize(result,session))
            }
        })
        return typeof source === 'string' ? output.join('') : output
    }

    export async function transformAsync<S = never>(source: string, rules: Dict<AsyncTransformer<S>>, session?: S): Promise<Element[]>
    export async function transformAsync<S = never>(source: Element[], rules: Dict<AsyncTransformer<S>>, session?: S): Promise<Element[]>
    export async function transformAsync<S>(source: string | Element[], rules: Dict<AsyncTransformer<S>>, session?: S) {
        const elements = typeof source === 'string' ? parse(source,source) : source
        const children = (await Promise.all(elements.map(async (element) => {
            const {type, attrs, children} = element
            let result = rules[type] ?? rules.default ?? true
            if (typeof result === 'function') {
                result = await result(attrs, children, session)
            }
            if (result === true) {
                return [Element(type,attrs,await transformAsync(children, rules, session))]
            } else if (result !== false) {
                return normalize(result,session)
            } else {
                return []
            }
        }))).flat(1)
        return typeof source === 'string' ? children.join('') : children
    }
    export type Factory<R extends Dict> = (attrs:R) => Element

    function createFactory<R extends Dict=Dict>(type: string): Factory<R> {
        return (attrs) => {
            const element = Element(type)
            Object.assign(element.attrs,attrs||{})
            return element
        }
    }

    export let warn: (message: string) => void = () => {}

    function createAssetFactory(type: string,key='file'): Factory<{file_id:string|Buffer|ArrayBuffer}> {
        return (attrs) => {
            let file_id=attrs[key]
            let prefix = 'base64://'
            if (typeof file_id === 'string') {
                prefix = `data:${file_id};base64,`
            }
            if (is('Buffer', file_id)) {
                file_id = prefix + file_id.toString('base64')
            } else if (is('ArrayBuffer', file_id)) {
                file_id = prefix + arrayBufferToBase64(file_id)
            }
            if (file_id.startsWith('base64://')) {
                warn(`protocol "base64:" is deprecated and will be removed in the future, please use "data:" instead`)
            }
            return Element(type, { file_id })
        }
    }

}
export = Element