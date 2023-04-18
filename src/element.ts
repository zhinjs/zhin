import {evaluate,  isNullable, makeArray,Awaitable, Dict} from "@zhinjs/shared";
import {Component} from "@/component";
import {Readable} from "stream";
export interface Element<T extends Element.BaseType|string=string,A extends Element.Attrs<T>=Element.Attrs<T>> {
    [Element.key]: true
    type: T
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
        if (this.type === 'text') return this.attrs.text
        const inner = this.children.map(child => child.toString(strip)).join('')
        if (strip) return inner
        const attrs = Object.entries(this.attrs).map(([key, value]) => {
            if (isNullable(value)) return ''
            if (value === true) return ` ${key}`
            if (value === false) return ` no-${key}`
            return ` ${key}='${Element.escape('' + value)}'`
        }).join('')
        if (!this.children.length) return `<${this.type}${attrs}/>`
        return `<${this.type}${attrs}>${inner}</${this.type}>`
    }
}

export function Element(type: string, ...children: Element.Fragment[]): Element
export function Element<T extends Element.BaseType|string>(type: T, attrs: Element.Attrs<T>, ...children: Element.Children<T>): Element<T>
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
    export type Children<T extends keyof Element.BaseChildren|string> = T extends keyof Element.BaseChildren?Element.BaseChildren[T]:Element[]
    export type Attrs<T extends Element.BaseType|string>=T extends Element.BaseType?Element.BaseAttrs[T] & Record<string, any>:Record<string, any>
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
    export type Render<S, A extends Dict = Dict, T = Awaitable<Fragment>> = (this:S,attrs: A, children: Element[]) => T

    export type Fragment = string | number | boolean | Element | (string | number | boolean | Element)[]

    export interface BaseAttrs{
        image:{src:string|Buffer|Readable},
        record:{src:string|Buffer|Readable},
        video:{src:string|Buffer|Readable},
        audio:{src:string|Buffer|Readable},
        text:{text:string},
        mention:{user_id:string|number}
        face:{id:number}
        node:{user_id:string,user_name?:string,time?:number,message?:Element.Fragment[]}
    }
    export interface BaseChildren{
        forward:Element<'node'>[]
    }
    export type BaseType=keyof BaseAttrs

    export function escape(source: string, inline = false) {
        const result = source
            .replace('"','\"')
            .replace("'","\'")
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
        return inline
            ? result.replace(/"/g, '&quot;')
            : result
    }

    export function unescape(source: string) {
        return source
            .replace('\"','"')
            .replace("\'","'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#(\d+);/g, (_, code) => code === '38' ? _ : String.fromCharCode(+code))
            .replace(/&#x([0-9a-f]+);/gi, (_, code) => code === '26' ? _ : String.fromCharCode(parseInt(code, 16)))
            .replace(/&(amp|#38|#x26);/g, '&')
    }

    const tagRegExp = /<!--[\s\S]*?-->|<(\/?)([^!\s>/]*)([^>]*?)\s*(\/?)>/
    const attrRegExp = /([^\s=]+)(?:="([^"]*)"|='([^']*)')?/g
    const interpRegExp = /\{\{([^{{]*)\}\}/

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
        source=source.replace(/<>([^<>]*)<\/>/g,(s,a)=>`<template>${a}</template>`)
        function pushText(content: string) {
            if (content) tokens.push(Element('text', {text: content}))
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
                    if (key.startsWith(':')) {
                        let result=evaluate<S>(v2, context)
                        token.attrs[key.slice(1)] = result===`return(${v2})`?`:${v2}`:result
                    } else {
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
                    let result=evaluate(expr, context)
                    const content = result===`{{${context}}}`?context:result
                    tokens.push(...toElementArray(content))
                }
            }
            pushText(unescape(source))
        }
        const root=Element(Fragment)
        const stack = [root]

        function rollback(index: number) {
            for (; index > 0; index--) {
                const {children} = stack.shift()
                const {source} = stack[0].children.pop()
                const element=Element('text', {text: source})
                stack[0].children.push(element)
                stack[0].children.push(...children)
            }
        }

        for (const token of tokens) {
            if (isElement(token)) {
                stack[0].children.push(token)
            } else if (token.close) {
                let index = 0
                while (index < stack.length && stack[index].type !== token.type) index++
                if (index === stack.length) {
                    // no matching open tag
                    const child=Element('text', {text: token.source})
                    stack[0].children.push(child)
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

    export function stringify(fragment: Element.Fragment) {
        if (!Array.isArray(fragment)) fragment = [fragment]
        return fragment.map((element) => {
            if (typeof element === 'string' || typeof element === 'number' || typeof element === 'boolean') element = Element('text', {text: element+''})
            return element.toString()
        }).join('')
    }
    export function render<S>(source: string | Element[], rules: Dict<Component>, session: S,runtime:Component.Runtime={session:session as any}) {
        const elements=[].concat(source).reduce((result:Element[],item:string|boolean|number|Element)=>{
            if(Element.isElement(item)) result.push(item)
            else{
                result.push(...parse(item+'',session))
            }
            return result
        },[] as Element[])
        const output: Fragment[] = []
        elements.forEach((element) => {
            const {type, attrs={}} = element
            let component:Component|Fragment = rules[type] ?? rules.default ?? true
            if (typeof component!=="boolean" && typeof component==='object' && !(component instanceof Element)) {
                runtime=Component.createRuntime(runtime,component,attrs)
                Object.assign(runtime,transform(element,runtime))
                component =render.apply(runtime,[element.attrs, element.children]) as Fragment
            }
            if (component === true) {
                output.push(element)
            } else if (component !== false) {
                output.push(...render(toElementArray(component as Fragment),rules,session,runtime))
            }
        })
        return typeof source === 'string' ? output.join('') : output
    }
    function transform(element:Element,runtime){
        const {attrs,children}=element
        for(const e of children){
            if(e.type!=='text' || !(interpRegExp.test(e.attrs.text))) continue
            const [_, expr] = interpRegExp.exec(e.attrs.text)
            let result=evaluate(expr,runtime)
            e.attrs.text=result===`return(${expr})`?`{{${expr}}`:result
        }
        for(const key in attrs){
            if(typeof attrs[key]!=='string' || !attrs[key].startsWith(':')) continue
            const val=attrs[key].replace(':','')
            let result=evaluate(val,runtime)
            attrs[key]=result===`return(${val})`?`:${val}`:result
        }
        element.attrs=attrs
        element.children=children
        return {
            attrs,
            children
        }
    }
    export async function renderAsync<S>(source: Element.Fragment, rules: Dict<Component>, session?: S,runtime:Component.Runtime= {session:session as any}) {
        const elements:Element[]=[].concat(source).reduce((result:Element[],item:string|boolean|number|Element)=>{
            if(Element.isElement(item)) result.push(item)
            else{
                result.push(...parse(item+'',session))
            }
            return result
        },[] as Element[])
        const result: Element[] = []
        for (const element of elements) {
            const {type, attrs={}} = element
            let component:Component|Fragment = rules[type] ?? rules.default ?? true
            if (typeof component!=="boolean" && typeof component==='object' && !(component instanceof Element)) {
                runtime=Component.createRuntime(runtime,component,attrs)
                Object.assign(runtime,transform(element,runtime))
                const {render}=component
                component =await render.apply(runtime,[element.attrs, element.children]) as Fragment
            }
            if (component === true) {
                result.push(element)
            } else if (component !== false) {
                result.push(...await renderAsync(toElementArray(component as Fragment),rules,session,runtime))
            }
        }
        return result
    }
    export let warn: (message: string) => void = () => {
    }
}
export const h=Element