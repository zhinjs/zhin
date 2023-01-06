import {Awaitable, Dict} from "@/types";
import {SegmentMap, Sendable} from "@/bot";
import {arrayBufferToBase64, camelize, hyphenate, interpolate, isNullable, makeArray} from "@/utils";
import {Session} from "@/session";

export interface Element {
    type: string
    attrs: Dict
    source: Sendable
    children: Element[]
}

interface Token {
    type: string
    close: string
    empty: string
    attrs: Dict
    source: string
}

function toElementArray(content: Fragment) {
    if (Array.isArray(content)) {
        return content.map(toElement).filter(x => x)
    } else {
        return [toElement(content)].filter(x => x)
    }
}
function toElement(content: string | Element) {
    if (typeof content === 'string' || typeof content === 'number' || typeof content === 'boolean') {
        content = '' + content
        if (content) return createElement('text', {content})
    } else if (Element.isElement(content)) {
        return content
    } else if (!isNullable(content)) {
        throw new TypeError(`Invalid content: ${content}`)
    }
}


export class Element {
    constructor(type: string, ...children: Fragment[])
    constructor(type: string, attrs: Dict, ...children: Fragment[])

    constructor(type: string, ...args: any[]) {
        let attrs: Dict = {}, children: Element[] = []
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
        return Object.assign(this, {type, attrs, children})
    }

    toString(strip = false) {
        if (this.type === 'text') return Element.escape(this.attrs.content)
        const inner = this.children.map((child) => child.toString(strip)).join('')
        if (strip) return inner
        const attrs = Object.entries(this.attrs).map(([key, value]) => {
            if (isNullable(value)) return ''
            key = hyphenate(key)
            if (value === true) return ` ${key}`
            if (value === false) return ` no-${key}`
            return ` ${key}="${Element.escape('' + value, true)}"`
        }).join('')
        if (!this.children.length) return `<${this.type}${attrs}/>`
        return `<${this.type}${attrs}>${inner}</${this.type}>`
    }
}

export namespace Element {
    const tagRegExp = /<!--[\s\S]*?-->|<(\/?)\s*([^!\s>/]*)([^>]*?)\s*(\/?)>/
    const attrRegExp1 = /([^\s=]+)(?:="([^"]*)"|='([^']*)')?/g
    const attrRegExp2 = /([^\s=]+)(?:="([^"]*)"|='([^']*)'|=\{([^}]+)\})?/g
    const interpRegExp = /\{([^}]*)\}/
    export const Fragment = 'template'
    export type Render<T, S> = (attrs: Dict, children: Element[], context: S) => T
    export type Transformer<S = never> = boolean | Fragment | Render<boolean | Fragment, S>
    export type AsyncTransformer<S = never> = boolean | Fragment | Render<Awaitable<boolean | Fragment>, S>


    export function isElement(source: any): source is Element {
        return source && typeof source === 'object' && source instanceof Element
    }
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

    export function parse(source: string, context?: Session): Element[] {
        const tokens: (Element | Token)[] = []

        function pushText(content: string) {
            if (content) tokens.push(createElement('text', {content}))
        }

        const attrRegExp = context ? attrRegExp2 : attrRegExp1
        let tagCap: RegExpExecArray
        while ((tagCap = tagRegExp.exec(source))) {
            parseContent(source.slice(0, tagCap.index))
            const [_, close, type, attrs, empty] = tagCap
            source = source.slice(tagCap.index + _.length)
            if (_.startsWith('<!')) continue
            const token: Token = {source: _, type: type || Element.Fragment, close, empty, attrs: {}}
            let attrCap: RegExpExecArray
            while ((attrCap = attrRegExp.exec(attrs))) {
                const [_, key, v1, v2 = v1, v3] = attrCap
                if (v3) {
                    token.attrs[camelize(key)] = interpolate(v3, context)
                } else if (!isNullable(v2)) {
                    token.attrs[camelize(key)] = unescape(v2)
                } else if (key.startsWith('no-')) {
                    token.attrs[camelize(key.slice(3))] = false
                } else {
                    token.attrs[camelize(key)] = true
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
                    const content = interpolate(expr, context)
                    tokens.push(...toElementArray(content))
                }
            }
            pushText(unescape(source))
        }

        const stack = [createElement(Fragment)]

        function rollback(index: number) {
            for (; index > 0; index--) {
                const {children} = stack.shift()
                const {source} = stack[0].children.pop()
                stack[0].children.push(createElement('text', {content: source}))
                stack[0].children.push(...children)
            }
        }

        for (const token of tokens) {
            if (Element.isElement(token)) {
                stack[0].children.push(token)
            } else if (token.close) {
                let index = 0
                while (index < stack.length && stack[index].type !== token.type) index++
                if (index === stack.length) {
                    // no matching open tag
                    stack[0].children.push(createElement('text', {content: token.source}))
                } else {
                    rollback(index)
                    const element = stack.shift()
                    delete element.source
                }
            } else {
                const element = createElement(token.type, token.attrs)
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

    export function transform<S = never>(source: string, rules: Dict<Transformer<S>>, context?: S): string
    export function transform<S = never>(source: Element[], rules: Dict<Transformer<S>>, context?: S): Element[]
    export function transform<S>(source: string | Element[], rules: Dict<Transformer<S>>, context?: S) {
        const elements = typeof source === 'string' ? Element.parse(source) : source
        const output: Element[] = []
        elements.forEach((element) => {
            const {type, attrs, children} = element
            let result = rules[type] ?? rules.default ?? true
            if (typeof result === 'function') {
                result = result(attrs, children, context)
            }
            if (result === true) {
                output.push(createElement(type, attrs, transform(children, rules, context)))
            } else if (result !== false) {
                output.push(...normalize(result))
            }
        })
        return typeof source === 'string' ? output.join('') : output
    }

    export async function transformAsync<S = never>(source: string, rules: Dict<AsyncTransformer<S>>, context?: S): Promise<string>
    export async function transformAsync<S = never>(source: Element[], rules: Dict<AsyncTransformer<S>>, context?: S): Promise<Element[]>
    export async function transformAsync<S>(source: string | Element[], rules: Dict<AsyncTransformer<S>>, context?: S) {
        const elements = typeof source === 'string' ? parse(source) : source
        const children = (await Promise.all(elements.map(async (element) => {
            const {type, attrs, children} = element
            let result = rules[type] ?? rules.default ?? true
            if (typeof result === 'function') {
                result = await result(attrs, children, context)
            }
            if (result === true) {
                return [createElement(type, attrs, await transformAsync(children, rules, context))]
            } else if (result !== false) {
                return normalize(result)
            } else {
                return []
            }
        }))).flat(1)
        return typeof source === 'string' ? children.join('') : children
    }

}
export type Fragment = string | Element | (string | Element)[]
export type Factory<T extends keyof SegmentMap> = (...args: [data: SegmentMap[T], attrs?: Dict]) => Element

function createFactory<T extends keyof SegmentMap>(type: T, ...keys: (keyof SegmentMap[T])[]): Factory<T> {
    return (data, attrs) => {
        const element = createElement(type)
        keys.forEach((key, index) => {
            element.attrs[key as string] = data[key]
        })
        if (attrs) {
            Object.assign(element.attrs, attrs)
        }
        return element
    }
}


function createAssetFactory<T extends keyof SegmentMap>(type: T, key: keyof SegmentMap[T]): Factory<T> {
    return (data, attrs = {}) => {
        let prefix = 'base64://'
        let url = data[key] as unknown
        if (typeof url === 'string') {
            prefix = `data:${url};base64,`
        }
        if (url instanceof Buffer) {
            url = prefix + url.toString('base64')
        } else if (url instanceof ArrayBuffer) {
            url = prefix + arrayBufferToBase64(url)
        }
        return createElement(type, {url, ...attrs})
    }
}

const segment = {
    text: createFactory('text', 'text'),
    mention: createFactory('mention', 'user_id'),
    reply: createFactory('reply', 'message_id'),
    image: createAssetFactory('image', 'file_id'),
    video: createAssetFactory('voice', 'file_id'),
    audio: createAssetFactory('audio', 'file_id'),
    file: createAssetFactory('file', 'file_id'),
}

export function createElement(type: string, ...children: Fragment[]): Element
export function createElement(type: string, attrs: Dict, ...children: Fragment[]): Element
export function createElement(type: string, ...args: any[]) {
    return new Element(type, ...args)
}

export {segment}