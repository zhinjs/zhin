import {evaluate, isNullable, makeArray, Awaitable, Dict} from "@zhinjs/shared";
import {Component} from "@/component";
import {Readable} from "stream";
import {Session} from "@/session";

export interface Element<T extends Element.BaseType | string = string, A extends Element.Attrs<T> = Element.Attrs<T>> {
    [Element.key]: true
    type: T
    loop?: string
    when?: string
    attrs: Element.Attrs<T>
    children: (Element)[]
    source?: string

    toString(strip?: boolean): string
}

interface ElementConstructor extends Element {

}

class ElementConstructor {
    name: string = 'Element';

    toString(strip = false) {
        if (this.type === 'text') return Element.escape(this.attrs.text||'')
        const inner = this.children.map(child => child.toString(strip)).join('')
        if (strip) return inner
        let attrs = Object.entries(this.attrs).map(([key, value]) => {
            if (isNullable(value)) return ''
            if (value === true) return ` ${key}`
            if (value === false) return ` no-${key}`
            if(value instanceof Buffer) return ` ${key}='base64://${value.toString('base64')}'`
            if(typeof value ==='object') return ` ${key}='${JSON.stringify(value)}'`
            return ` ${key}='${Element.escape('' + value)}'`
        }).join('')
        if (this.loop) attrs += ` v-for="${this.loop}"`
        if (this.when) attrs += ` v-if="${this.when}"`
        if (!this.children.length) return `<${this.type}${attrs}/>`
        return `<${this.type}${attrs}>${inner}</${this.type}>`
    }
}

type ArrayToString<T extends any[]> = T extends [infer A, ...infer B] ? A extends Element ? `${ToString<A>}${ArrayToString<B>}` : '' : ''
type ToString<E extends Element, C extends any[] = []> = E extends Element<infer T, infer A> ? C extends Element.Children<T> ? `<${T} ${Stringify<A>}>${ArrayToString<C>}</${T}>` : `<${T} ${Stringify<A>}/>` : string
type Stringify<T extends Dict> = { [K in keyof T]: K extends string | number | bigint ? T[K] extends boolean ? (T[K] extends true ? K : `no-${K}`) : `${K}='${T[K]}'` : string }[keyof T]

export function Element(type: string, ...children: Element.Fragment[]): Element
export function Element<T extends Element.BaseType | string>(type: T, attrs: Element.Attrs<T>, ...children: Element.Children<T>): Element<T, Element.Attrs<T>>
export function Element(type: string, ...args: any[]) {
    const el = Object.create(ElementConstructor.prototype)
    el[Element.key] = true
    let attrs: Dict = {}, children: Element.Fragment[] = []
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
        children.push(...Element.toElementArray(child))
    }
    return Object.assign(el, {type, attrs, children})
}

export namespace Element {
    export const key = Symbol('zhinElement')

    export function isElement(source: any): source is Element {
        return source && typeof source === 'object' && source[Element.key]
    }

    export type Children<T extends keyof Element.BaseChildren | string> = T extends keyof Element.BaseChildren ? Element.BaseChildren[T] : Element[]
    export type Attrs<T extends Element.BaseType | string> = T extends Element.BaseType ? Element.BaseAttrs[T] & Record<string, any> : Record<string, any>

    function toElement(content: Element.Fragment) {
        if (Element.isElement(content)) {
            return content
        }
        if (Array.isArray(content)) {
            return Element('text', {text: `[${content.join()}]`})
        }
        return Element('text', {text: content.toString()})
    }

    export function toElementArray(content: Element.Fragment): (Element)[] {
        if (Array.isArray(content)) {
            return content.map(toElement).filter(Boolean)
        } else {
            return [toElement(content)].filter(Boolean)
        }
    }

    export const Fragment = 'template'
    export type Render<S, A extends Dict = Dict, T = Awaitable<Fragment>> = (this: S, attrs: A, children: Element[]) => T

    export type Fragment = string | number | boolean | Element | (string | number | boolean | Element)[]

    export interface BaseAttrs {
        image: { src: string | Buffer },
        record: { src: string | Buffer },
        video: { src: string | Buffer },
        audio: { src: string | Buffer },
        text: { text: string },
        mention: { user_id: string | number }
        face: { id: number }
        node: { user_id: string, user_name?: string, time?: number, message?: Element.Fragment[] }
    }

    export interface BaseChildren {
        forward: Element<'node'>[]
    }

    export type BaseType = keyof BaseAttrs

    export function escape(source: string, inline = false) {
        const result = source
            .replace('"', '\"')
            .replace("'", "\'")
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
        return inline
            ? result.replace(/"/g, '&quot;')
            : result
    }

    export function unescape(source: string) {
        return source
            .replace('\"', '"')
            .replace("\'", "'")
            .replace(/&(amp|#38|#x26);/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#(\d+);/g, (_, code) => code === '38' ? _ : String.fromCharCode(+code))
            .replace(/&#x([0-9a-f]+);/gi, (_, code) => code === '26' ? _ : String.fromCharCode(parseInt(code, 16)))
    }

    const tagRegExp = /<!--[\s\S]*?-->|<(\/?)([^!\s>/]*)([^>]*?)\s*(\/?)>/
    const attrRegExp = /([^\s=]+)(?:="([^"]*)"|='([^']*)')?/g

    // 匹配双大括号里面的内容，可以包含{foo:bar}，${}，但是不能包含{{}}，因为{{}}会被当做表达式
    interface Token {
        type: string
        close: string
        loop?: string
        when?: string
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
        source = source.replace(/<>([^<>]*)<\/>/g, (s, a) => `<template>${a}</template>`)

        function fixAttr(attrString: string, element: Element) {
            const attrs = element.attrs ||= {}
            // 匹配出所有属性，包含不带值的属性
            const attrRegExp = /(?:([^\s=]+)(?:="([^"]*)"|='([^']*)')?|([^\s=]+))\s*/g
            attrString.replace(attrRegExp, (s, key, value1, value2) => {
                attrs[key] = value1 || value2 || ''
                if (!attrs[key]) {
                    if (key.startsWith('no-')) {
                        attrs[key.slice(3)] = false
                    } else {
                        attrs[key] = true
                    }
                }
                return ''
            })
            for (let key in element.attrs ||= {}) {
                let value = String(element.attrs[key])
                if (key === 'v-for') {
                    element.loop = value
                    delete element.attrs[key]
                } else if (key === 'condition') {
                    element.when = value
                    delete element.attrs[key]
                } else if (key.startsWith(':')) {
                    delete element.attrs[key]
                    const newKey = key.slice(1)
                    element.attrs[newKey] = `:${value}`
                } else if (isNullable(value)) {
                    element.attrs[key] = false
                } else if (key.startsWith('no-')) {
                    const newKey = key.replace('no-', '')
                    delete element.attrs[key]
                    element.attrs[newKey] = true
                }
            }
        }

        function analyzeHtml(content: string) {
            const result = []
            if (!content.length) return result
            let matched: RegExpMatchArray, closeMatched: RegExpMatchArray;
            const tagCap = /<([a-z]+)(?:\s+([^>]*))?>((?:.|\n)*?)<\/\1>/g
            const tagCloseCap = /<([^\s>]+)(.*?)\/>/g
            while ((matched = tagCap.exec(content)) || (closeMatched = tagCloseCap.exec(content))) {
                if (matched) {
                    if (matched.index !== 0) {
                        let source = content.substring(0, matched.index)
                        while (source.match(tagCloseCap)) {
                            closeMatched = tagCloseCap.exec(source)
                            if (closeMatched.index !== 0) {
                                let source2 = source.substring(0, closeMatched.index)
                                source = source.replace(source2, '')
                                const element = Element('text', {
                                    text: source2
                                })
                                element.source = source2
                                fixAttr('', element)
                                result.push(element)
                            }
                            const [source2, type, attrString] = closeMatched
                            source = source.substring(source2.length, source.length)
                            const element = Element(type, {})
                            element.source = source2
                            fixAttr(attrString, element)
                            result.push(element)
                        }
                        content = content.substring(matched.index, content.length)
                        const element = Element('text', {
                            text: source
                        })
                        element.source = source
                        fixAttr('', element)
                        result.push(element)
                    }
                    const [source, type, attrString = '', children = ''] = matched
                    content = content.replace(source, '')
                    const element = Element(type, {}, ...analyzeHtml(children))
                    element.source = source
                    fixAttr(attrString, element)
                    result.push(element)
                } else if (closeMatched) {
                    if (closeMatched.index !== 0) {
                        const source = content.substring(0, closeMatched.index)
                        content = content.replace(source, '')
                        const element = Element('text', {
                            text: source
                        })
                        element.source = source
                        fixAttr('', element)
                        result.push(element)
                    }
                    const [source, type, attrString] = closeMatched
                    content = content.replace(source, '')
                    const element = Element(type, {})
                    fixAttr(attrString, element)
                    element.source = source
                    result.push(element)
                }
                tagCap.lastIndex = 0
                tagCloseCap.lastIndex = 0
            }
            if (0 !== content.length) {
                const source = content.substring(0, content.length)
                const element = Element('text', {
                    text: source
                })
                element.source = source
                fixAttr('', element)
                result.push(element)
            }
            return result
        }

        return analyzeHtml(source)
    }

    export function stringify(fragment: Element.Fragment) {
        if (!Array.isArray(fragment)) fragment = [fragment]
        return fragment.map((element) => {
            if (typeof element === 'string' || typeof element === 'number' || typeof element === 'boolean') element = Element('text', {text: element + ''})
            return element.toString()
        }).join('')
    }

    function transform(element: Element, runtime) {
        const {attrs, children} = element
        for (const e of [element, ...children]) {
            if (e.type !== 'text') continue
            if (!e.attrs.text) continue
            const exprRegExp = /{{([^{}]*?)}}/g
            let matched
            while (matched = exprRegExp.exec(e.attrs.text)) {
                const [_, expr] = matched
                let result = expr.match(/^((process|console)\.)|import|require/) ? e.attrs.text : evaluate(expr, runtime);
                if (typeof result !== 'string') {
                    try {
                        result = JSON.stringify(result, null, 2)
                    } catch {
                        result = expr
                    }
                }
                const replacer = result === `return(${expr})` ? `{{${expr}}}` : result
                e.attrs.text = e.attrs.text.replace(`{{${expr}}}`, replacer)
                exprRegExp.lastIndex = e.attrs.text.indexOf(replacer) + replacer.length
            }
        }
        for (const key in attrs) {
            if (typeof attrs[key] !== 'string' || (!attrs[key].startsWith(':'))) continue
            const val: string = attrs[key].replace(':', '')
            let result = val.match(/^process\./) ? val : evaluate(val, runtime);
            if (typeof result !== 'string') {
                try {
                    result = JSON.stringify(result)
                } catch {
                    result = val
                }
            }
            attrs[key] = result === `return(${val})` ? `:${val}` : result
        }
        element.attrs = attrs
        element.children = children
        return {
            attrs,
            children
        }
    }

    export function render<S>(source: string | Element[], rules: Dict<Component>, session: S, runtime: Component.Runtime = {session: session as any}) {
        const elements = [].concat(source).reduce((result: Element[], item: string | boolean | number | Element) => {
            if (Element.isElement(item)) result.push(item)
            else {
                result.push(...parse(item + '', session))
            }
            return result
        }, [] as Element[])
        const output: Fragment[] = []
        elements.forEach((element) => {
            const {type, attrs = {}, when, loop} = element
            let component: Component | Fragment = rules[type] ?? rules.default ?? true
            if (typeof component !== "boolean" && typeof component === 'object' && !(component instanceof Element)) {
                runtime = Component.createRuntime(runtime, component, attrs)
                const {render} = component
                if (loop) {
                    const [_, name, value] = /(\S+)\sin\s(\S+)/.exec(loop);
                    const fn = new Function('element,transform,render,runtime', `const RESULT=[];for(const ${name} in runtime.${value}){Object.assign(runtime,{...transform(element,runtime),${name}:runtime.${value}[${name}]});with (runtime) {RESULT.push(render.apply(runtime,[element.attrs,element.children]));};};return RESULT;`);
                    component = fn(element, transform, render, runtime).flat()
                } else {
                    if (when && !evaluate(when, runtime)) return
                    Object.assign(runtime, transform(element, runtime))
                    component = render.apply(runtime, [element.attrs, element.children]) as Fragment
                }
            }
            if (component === true) {
                if (loop) {
                    const [_, name, value] = /(\S+)\sin\s(\S+)/.exec(loop);
                    const fn = new Function('element,transform,runtime', `const RESULT=[];for(const ${name} in runtime.${value}){Object.assign(runtime,{${name}:runtime.${value}[${name}]});RESULT.push({...element,...transform(element,runtime)})};return RESULT;`)
                    output.push(...fn(element, transform, runtime))
                } else {
                    const newAttrs = transform(element, runtime)
                    Object.assign(element, newAttrs)
                    output.push(element)
                }
            } else if (component !== false) {
                output.push(...render(toElementArray(component as Fragment), rules, session, runtime))
            }
        })
        return typeof source === 'string' ? output.join('') : output
    }

    export async function renderAsync<S>(this: Session<any>, source: Element.Fragment, rules: Dict<Component>, runtime?: Component.Runtime) {
        if (!runtime) runtime = {session: this as any}
        const elements: Element[] = [].concat(source).reduce((result: Element[], item: string | boolean | number | Element) => {
            if (Element.isElement(item)) result.push(item)
            else {
                result.push(...parse(item + '', this))
            }
            return result
        }, [] as Element[])
        const result: Element[] = []
        for (const element of elements) {
            const {type, attrs = {}, loop, when} = element
            let component: Component | Fragment = rules[type] ?? rules.default ?? true
            if (typeof component !== "boolean" && typeof component === 'object' && !(component instanceof Element)) {
                runtime = Component.createRuntime(runtime, component, attrs)
                const {render} = component
                if (loop) {
                    const [_, name, value] = /(\S+)\sin\s(\S+)/.exec(loop);
                    const fn = new Function('element,transform,render,runtime', `const RESULT=[];for(const ${name} in runtime.${value}){Object.assign(runtime,{...transform(element,runtime),${name}:runtime.${value}[${name}]});with (runtime) {RESULT.push(render.apply(runtime,[element.attrs,element.children]));};};return RESULT;`);
                    component = (await Promise.all(fn(element, transform, render, runtime))).flat()
                } else {
                    if (when && !evaluate(when, runtime)) continue
                    Object.assign(runtime, transform(element, runtime))
                    component = await render.apply(runtime, [element.attrs, element.children]) as Fragment
                }
            }
            if (component === true) {
                if (loop) {
                    const [_, name, value] = /(\S+)\sin\s(\S+)/.exec(loop);
                    const fn = new Function('element,transform,runtime', `const RESULT=[];for(const ${name} in runtime.${value}){Object.assign(runtime,{${name}:runtime.${value}[${name}]});RESULT.push({...element,...transform(element,runtime.session)})};return RESULT;`)
                    result.push(...fn(element, transform, runtime))
                } else {
                    const newAttrs = transform(element, runtime)
                    Object.assign(element, newAttrs)
                    result.push(element)
                }
            } else if (component !== false) {
                result.push(...await renderAsync.apply(this, [toElementArray(component as Fragment), rules, runtime]))
            }
        }
        return result
    }

    export let warn: (message: string) => void = () => {
    }
}
export function h(type: string, ...children: Element.Fragment[]): string
export function h<T extends Element.BaseType | string,C extends Element.Children<T>[]>(type: T, attrs: Element.Attrs<T>, ...children: C): ToString<Element<T,Element.Attrs<T>>,C>
export function h(type: string, ...args: any[]){
    return Element(type,...args).toString()
}
