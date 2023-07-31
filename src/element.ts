import { evaluate, isNullable, makeArray, Awaitable, Dict } from "@zhinjs/shared";
import { Component } from "@/component";
import { Session } from "@/session";
import { findLastIndex, removeOuterQuoteOnce } from "@/utils";

export interface Element<
    T extends Element.BaseType | string = string,
    A extends Element.Attrs<T> = Element.Attrs<T>,
> {
    [Element.key]: true;
    type: T;
    loop?: string;
    when?: string;
    attrs: Element.Attrs<T>;
    children: Element[];
    source?: string;

    toString(strip?: boolean): string;
}

interface ElementConstructor extends Element {}

class ElementConstructor {
    name: string = "Element";

    toString(strip = false) {
        if (this.type === "text") return Element.escape(this.attrs.text || "");
        const inner = this.children.map(child => child.toString(strip)).join("");
        if (strip) return inner;
        let attrs = Object.entries(this.attrs)
            .map(([key, value]) => {
                if (isNullable(value)) return "";
                if (value === true) return ` ${key}`;
                if (value === false) return ` no-${key}`;
                if (value instanceof Buffer)
                    return ` ${key}='base64://${value.toString("base64")}'`;
                if (typeof value === "object") return ` ${key}='${JSON.stringify(value)}'`;
                return ` ${key}='${Element.escape("" + value)}'`;
            })
            .join("");
        if (this.loop) attrs += ` v-for="${this.loop}"`;
        if (this.when) attrs += ` v-if="${this.when}"`;
        if (!this.children.length) return `<${this.type}${attrs}/>`;
        return `<${this.type}${attrs}>${inner}</${this.type}>`;
    }
}

type ArrayToString<T extends any[]> = T extends [infer A, ...infer B]
    ? A extends Element
        ? `${ToString<A>}${ArrayToString<B>}`
        : ""
    : "";
export type ToString<E extends Element, C extends any[] = []> = E extends Element<infer T, infer A>
    ? C extends Element.Children<T>
        ? `<${T} ${Stringify<A>}>${ArrayToString<C>}</${T}>`
        : `<${T} ${Stringify<A>}/>`
    : string;
type Stringify<T extends Dict> = {
    [K in keyof T]: K extends string | number | bigint
        ? T[K] extends boolean
            ? T[K] extends true
                ? K
                : `no-${K}`
            : `${K}='${T[K]}'`
        : string;
}[keyof T];

export function Element(type: string, ...children: Element.Fragment[]): Element;
export function Element<T extends Element.BaseType | string>(
    type: T,
    attrs: Element.Attrs<T>,
    ...children: Element.Children<T>
): Element<T, Element.Attrs<T>>;
export function Element(type: string, ...args: any[]) {
    const el = Object.create(ElementConstructor.prototype);
    el[Element.key] = true;
    let attrs: Dict = {},
        children: Element.Fragment[] = [];
    if (
        args[0] &&
        typeof args[0] === "object" &&
        !Element.isElement(args[0]) &&
        !Array.isArray(args[0])
    ) {
        const props = args.shift();
        for (const [key, value] of Object.entries(props)) {
            if (isNullable(value)) continue;
            if (key === "children") {
                args.push(...makeArray(value));
            } else {
                attrs[key] = value;
            }
        }
    }
    for (const child of args) {
        if (child === null || child === undefined) continue;
        children.push(...Element.toElementArray(child));
    }
    return Object.assign(el, { type, attrs, children });
}

export namespace Element {
    export const key = Symbol("zhinElement");

    export function isElement(source: any): source is Element {
        return source && typeof source === "object" && source[Element.key];
    }

    export type Children<T extends keyof Element.BaseChildren | string> =
        T extends keyof Element.BaseChildren ? Element.BaseChildren[T] : Element[];
    export type Attrs<T extends Element.BaseType | string> = T extends Element.BaseType
        ? Element.BaseAttrs[T] & Record<string, any>
        : Record<string, any>;

    function toElement(content: Element.Fragment) {
        if (Element.isElement(content)) {
            return content;
        }
        if (Array.isArray(content)) {
            return Element("text", { text: `[${content.join()}]` });
        }
        return Element("text", { text: content.toString() });
    }

    export function toElementArray(content: Element.Fragment): Element[] {
        if (Array.isArray(content)) {
            return content.map(toElement).filter(Boolean);
        } else {
            return [toElement(content)].filter(Boolean);
        }
    }

    export const Fragment = "template";
    export type Render<S, A extends Dict = Dict, T = Awaitable<Fragment>> = (
        this: S,
        attrs: A,
        children: Element[],
    ) => T;

    export type Fragment =
        | string
        | number
        | boolean
        | Element
        | (string | number | boolean | Element)[];

    export interface BaseAttrs {
        image: { src: string | Buffer };
        record: { src: string | Buffer };
        video: { src: string | Buffer };
        audio: { src: string | Buffer };
        text: { text: string };
        mention: { user_id: string | number };
        face: { id: number };
        node: {
            user_id: string | number;
            user_name?: string;
            time?: number;
            message?: Element.Fragment[];
        };
    }

    export interface BaseChildren {
        forward: Element<"node">[];
    }

    export type BaseType = keyof BaseAttrs;

    export function escape(source: string, inline = false) {
        const result = source
            .replace('"', '"')
            .replace("'", "'")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        return inline ? result.replace(/"/g, "&quot;") : result;
    }

    export function unescape(source: string) {
        return source
            .replace('"', '"')
            .replace("'", "'")
            .replace(/&(amp|#38|#x26);/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#(\d+);/g, (_, code) => (code === "38" ? _ : String.fromCharCode(+code)))
            .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
                code === "26" ? _ : String.fromCharCode(parseInt(code, 16)),
            );
    }

    const tagRegExp = /<!--[\s\S]*?-->|<(\/?)([^!\s>/]*)([^>]*?)\s*(\/?)>/;
    const attrRegExp = /([^\s=]+)(?:="([^"]*)"|='([^']*)')?/g;

    // 匹配双大括号里面的内容，可以包含{foo:bar}，${}，但是不能包含{{}}，因为{{}}会被当做表达式
    interface Token {
        type: string;
        close: string;
        loop?: string;
        when?: string;
        empty: string;
        attrs: Dict;
        source: string;
    }

    type Combinator = " " | ">" | "+" | "~";

    export interface Selector {
        type: string;
        combinator: Combinator;
    }

    const combRegExp = / *([ >+~]) */g;

    export function parseSelector(input: string): Selector[][] {
        return input.split(",").map(query => {
            const selectors: Selector[] = [];
            query = query.trim();
            let combCap: RegExpExecArray,
                combinator: Combinator = " ";
            while ((combCap = combRegExp.exec(query))) {
                selectors.push({
                    type: query.slice(0, combCap.index),
                    combinator,
                });
                combinator = combCap[1] as Combinator;
                query = query.slice(combCap.index + combCap[0].length);
            }
            selectors.push({ type: query, combinator });
            return selectors;
        });
    }

    export function select(source: string | Element[], query: string | Selector[][]): Element[] {
        if (typeof source === "string") source = parse(source);
        if (typeof query === "string") query = parseSelector(query);
        if (!query.length) return;
        let adjacent: Selector[][] = [];
        const results: Element[] = [];
        for (const [index, element] of source.entries()) {
            const inner: Selector[][] = [];
            const local = [...query, ...adjacent];
            adjacent = [];
            let matched = false;
            for (const group of local) {
                const { type, combinator } = group[0];
                if (type === element.type || type === "*") {
                    if (group.length === 1) {
                        matched = true;
                    } else if ([" ", ">"].includes(group[1].combinator)) {
                        inner.push(group.slice(1));
                    } else if (group[1].combinator === "+") {
                        adjacent.push(group.slice(1));
                    } else {
                        query.push(group.slice(1));
                    }
                }
                if (combinator === " ") {
                    inner.push(group);
                }
            }
            if (matched) results.push(source[index]);
            results.push(...select(element.children, inner));
        }
        return results;
    }

    export function parse(source: string) {
        source = source.replace(/<>([^<>]*)<\/>/g, (s, a) => `<template>${a}</template>`);

        /**
         * 处理元素的属性(v-for,v-if,no-xxx,:xxx)
         * @param element
         */
        function fixAttr(element: Element) {
            const attrs = (element.attrs ||= {});
            // 匹配出所有属性，包含不带值的属性
            for (let key in (element.attrs ||= {})) {
                let value = String(element.attrs[key]);
                if (key === "v-for") {
                    element.loop = value;
                    delete element.attrs[key];
                } else if (key === "v-if") {
                    element.when = value;
                    delete element.attrs[key];
                } else if (key.startsWith(":")) {
                    delete element.attrs[key];
                    const newKey = key.slice(1);
                    element.attrs[newKey] = `:${value}`;
                } else if (key.startsWith("no-") && isNullable(value)) {
                    const newKey = key.replace("no-", "");
                    delete element.attrs[key];
                    element.attrs[newKey] = false;
                } else if (isNullable(value)) {
                    element.attrs[key] = false;
                }
            }
            if (element.children) element.children.forEach(fixAttr);
        }

        function analyzeHtml(content: string) {
            if (!content.length) return [];
            const stack = parseElementStack(content);
            for (const element of stack) {
                fixAttr(element);
            }
            return stack;
        }
        return analyzeHtml(source);
    }

    export function stringify(fragment: Element.Fragment) {
        if (!Array.isArray(fragment)) fragment = [fragment];
        return fragment
            .map(element => {
                if (
                    typeof element === "string" ||
                    typeof element === "number" ||
                    typeof element === "boolean"
                )
                    element = Element("text", { text: element + "" });
                return element.toString();
            })
            .join("");
    }

    function runWith(element: Element, runtime) {
        const { attrs, children } = element;
        for (const e of [element, ...children]) {
            if (e.type !== "text") continue;
            if (!e.attrs.text) continue;
            const exprRegExp = /{{([^{}]*?)}}/g;
            let matched;
            while ((matched = exprRegExp.exec(e.attrs.text))) {
                const [_, expr] = matched;
                let result = expr.match(/^((process|console)\.)|import|require/)
                    ? e.attrs.text
                    : evaluate(expr, runtime);
                if (typeof result !== "string") {
                    try {
                        result = JSON.stringify(result, null, 2);
                    } catch {
                        result = expr;
                    }
                }
                const replacer = result === `return(${expr})` ? `{{${expr}}}` : result;
                e.attrs.text = e.attrs.text.replace(`{{${expr}}}`, replacer);
                exprRegExp.lastIndex = e.attrs.text.indexOf(replacer) + replacer.length;
            }
        }
        for (const key in attrs) {
            if (typeof attrs[key] !== "string" || !attrs[key].startsWith(":")) continue;
            const val: string = attrs[key].replace(":", "");
            let result = val.match(/^process\./) ? val : evaluate(val, runtime);
            if (typeof result !== "string") {
                try {
                    result = JSON.stringify(result);
                } catch {
                    result = val;
                }
            }
            attrs[key] = result === `return(${val})` ? `:${val}` : result;
        }
        element.attrs = attrs;
        element.children = children;
        return {
            attrs,
            children,
        };
    }

    export function render<S>(
        source: string | Element[],
        rules: Dict<Component>,
        session: S,
        runtime: Component.Runtime = { session: session as any },
    ) {
        const elements = []
            .concat(source)
            .reduce((result: Element[], item: string | boolean | number | Element) => {
                if (Element.isElement(item)) result.push(item);
                else {
                    result.push(...parse(item + "", session));
                }
                return result;
            }, [] as Element[]);
        const output: Fragment[] = [];
        elements.forEach(element => {
            const { type, attrs = {}, when, loop } = element;
            let component: Component | Fragment = rules[type] ?? rules.default ?? true;
            if (
                typeof component !== "boolean" &&
                typeof component === "object" &&
                !(component instanceof Element)
            ) {
                runtime = Component.createRuntime(runtime, component, attrs);
                const { render } = component;
                if (loop) {
                    const [_, name, value] = /(\S+)\sin\s(\S+)/.exec(loop);
                    const fn = new Function(
                        "element,runWith,render,runtime",
                        `const RESULT=[];for(const ${name} in runtime.${value}){Object.assign(runtime,{...runWith(element,runtime),${name}:runtime.${value}[${name}]});with (runtime) {RESULT.push(render.apply(runtime,[element.attrs,element.children]));};};return RESULT;`,
                    );
                    component = fn(element, runWith, render, runtime).flat();
                } else {
                    if (when && !evaluate(when, runtime)) return;
                    Object.assign(runtime, runWith(element, runtime));
                    component = render.apply(runtime, [
                        element.attrs,
                        element.children,
                    ]) as Fragment;
                }
            }
            if (component === true) {
                if (loop) {
                    const [_, name, value] = /(\S+)\sin\s(\S+)/.exec(loop);
                    const fn = new Function(
                        "element,runWith,runtime",
                        `const RESULT=[];for(const ${name} in runtime.${value}){Object.assign(runtime,{${name}:runtime.${value}[${name}]});RESULT.push({...element,...runWith(element,runtime)})};return RESULT;`,
                    );
                    output.push(...fn(element, runWith, runtime));
                } else {
                    const newAttrs = runWith(element, runtime);
                    Object.assign(element, newAttrs);
                    output.push(element);
                }
            } else if (component !== false) {
                output.push(
                    ...render(toElementArray(component as Fragment), rules, session, runtime),
                );
            }
        });
        return typeof source === "string" ? output.join("") : output;
    }

    type Rule<T = any> = (attr: Dict, children?: (T | string)[]) => Promise<T> | T;

    /**
     * 将Element根据rules转换为其他类型
     * @param elements {Element[]} Element数组
     * @param rules {Dict<Rule>} 转换规则
     */
    export async function transform<T>(elements: Element[], rules: Dict<Rule<T>>) {
        let result: (T | string)[] = [];
        for (const element of elements) {
            let { type, children, attrs } = element;
            const rule = rules[type] ?? rules.default ?? true;
            if (rule === true) {
                result.push(element.toString());
                continue;
            }
            if (children && children.length) {
                result.push(await rule(attrs, await transform(children, rules)));
            } else {
                result.push(await rule(attrs));
            }
        }
        return result;
    }

    export async function renderAsync<S>(
        this: Session<any>,
        source: Element.Fragment,
        rules: Dict<Component>,
        runtime?: Component.Runtime,
    ) {
        if (!runtime) runtime = { session: this as any };
        const elements: Element[] = []
            .concat(source)
            .reduce((result: Element[], item: string | boolean | number | Element) => {
                if (Element.isElement(item)) result.push(item);
                else {
                    result.push(...parse(item + "", this));
                }
                return result;
            }, [] as Element[]);
        const result: Element[] = [];
        for (const element of elements) {
            const { type, attrs = {}, loop, when } = element;
            let component: Component | Fragment = rules[type] ?? rules.default ?? true;
            const fixLoop = (loop: string) => {
                let [_, name, value] = /(\S+)\sin\s(\S+)/.exec(loop);
                if (/\d+/.test(value))
                    value = `[${new Array(+value)
                        .fill(0)
                        .map((_, i) => i)
                        .join(",")}]`;
                if (/^\[.+]$/.test(value)) {
                    runtime["__loop__"] = JSON.parse(value);
                    value = "__loop__";
                }
                return { name, value };
            };
            if (
                typeof component !== "boolean" &&
                typeof component === "object" &&
                !(component instanceof Element)
            ) {
                runtime = Component.createRuntime(runtime, component, attrs);
                const { render } = component;
                if (loop) {
                    const { name, value } = fixLoop(loop);
                    const fn = new Function(
                        "element,runWith,render,runtime",
                        `const RESULT=[];for(const ${name} in runtime.${value}){Object.assign(runtime,{...runWith(element,runtime),${name}:runtime.${value}[${name}]});with (runtime) {RESULT.push(render.apply(runtime,[element.attrs,element.children]));};};return RESULT;`,
                    );
                    component = (await Promise.all(fn(element, runWith, render, runtime))).flat();
                    if (value === "__loop__") delete runtime["__loop__"];
                } else {
                    if (when && !evaluate(when, runtime)) continue;
                    Object.assign(runtime, runWith(element, runtime));
                    component = (await render.apply(runtime, [
                        element.attrs,
                        element.children,
                    ])) as Fragment;
                }
            }
            if (component === true) {
                if (loop) {
                    const { name, value } = fixLoop(loop);
                    const fn = new Function(
                        "element,runWith,runtime",
                        `const RESULT=[];for(const ${name} in runtime.${value}){Object.assign(runtime,{${name}:runtime.${value}[${name}]});RESULT.push({...element,...runWith(element,runtime.session)})};return RESULT;`,
                    );
                    const loopResult = await fn(element, runWith, runtime);
                    if (value === "__loop__") delete runtime["__loop__"];
                    for (const item of loopResult) {
                        if (item.children)
                            item.children = await renderAsync.call(
                                this,
                                item.children,
                                rules,
                                runtime,
                            );
                        result.push(item);
                    }
                } else {
                    const newAttrs = runWith(element, runtime);
                    Object.assign(element, newAttrs);
                    if (element.children)
                        element.children = await renderAsync.call(
                            this,
                            element.children,
                            rules,
                            runtime,
                        );
                    result.push(element);
                }
            } else if (component !== false) {
                result.push(
                    ...(await renderAsync.call(
                        this,
                        toElementArray(component as Fragment),
                        rules,
                        runtime,
                    )),
                );
            }
        }
        return result;
    }

    /**
     * 解析模板字符串为Element数组，支持嵌套
     * @param template {string} 模板字符串
     * @returns {Element[]} Element数组
     */
    export const parseElementStack = (template: string) => {
        const regex = /("[^"]*?"|'[^']*?'|`[^`]*?`|“[^”]*?”|‘[^’]*?’|<[^>]+?>)/;
        const stack: Element[] = []; // 结果栈
        while (template.length) {
            const [match] = template.match(regex) || [];
            if (!match) break;
            const index = template.indexOf(match);
            const prevText = template.slice(0, index);
            if (prevText) {
                const ele = Element("text", { text: prevText });
                ele.source = prevText;
                stack.push(ele);
            }
            template = template.slice(index + match.length);
            if (match.startsWith("<")) {
                // 起始标签
                if (match.startsWith("</")) {
                    // 结束标签
                    const type = match.slice(2, -1); // 获取标签类型
                    // 找到最近的开始标签
                    const startTagIndex = findLastIndex(stack, item => item.type === type);
                    if (startTagIndex === -1) {
                        // 没有找到开始标签，将结束标签作为文本节点
                        const ele = Element("text", { text: match });
                        ele.source = match;
                        stack.push(ele);
                        continue;
                    }
                    // 找到开始标签，将开始标签和结束标签之间的元素作为子元素
                    const needJoinArg = stack.splice(startTagIndex);
                    const [element, ...children] = needJoinArg;
                    element.children = children;
                    element.source += `${children.map(child => child.source).join("")}${match}`;
                    stack.push(element);
                } else {
                    const [type, ...attrStrArr] = match
                        .slice(1, match.endsWith("/>") ? -2 : -1) // 去除首尾尖括号以及尾部斜杠(自闭合标签)
                        .match(/[^=\s]+(=(".*?"|'.*?'|`.*?`|“.*?”|‘.*?’))?/g) // 按空格分割，但是属性值中的空格不分割
                        .filter(Boolean); // 去除空字符串
                    // 将属性字符串数组转换为对象
                    const attrs: Dict = attrStrArr.reduce((result, item) => {
                        const [key, value] = item.split("=");
                        result[key] = removeOuterQuoteOnce(value);
                        return result;
                    }, {} as Dict);
                    const element = Element(type, attrs);
                    element.source = match;
                    stack.push(element);
                }
            } else {
                // 文本
                const ele = Element("text", { text: match });
                ele.source = match;
                stack.push(ele);
            }
        }
        // 处理剩余的文本
        if (template) {
            const ele = Element("text", { text: template });
            ele.source = template;
            stack.push(ele);
        }
        return stack;
    };
    export let warn: (message: string) => void = () => {};
}
export const Fragment = Element.Fragment;

export function stringify<T extends Element.Fragment>(source: T): string {
    if (typeof source === "string") return source;
    if (Array.isArray(source)) return source.map(stringify).join("");
    if (!Element.isElement(source)) return "";
    return source.source || source.toString();
}

export const h = Element;
