import { getValueWithRuntime, compiler, segment } from './utils.js';
import { Dict, SendContent, SendOptions } from './types.js';
import { Message } from "./message.js";

// 组件匹配符号
export const CapWithChild = Symbol('CapWithChild');
export const CapWithClose = Symbol('CapWithClose');

// 函数式组件类型定义
export type Component<P = any> = {
    (props: P, context: ComponentContext): Promise<SendContent>;
    name: string;
}


// 组件上下文接口 - 通过闭包严格控制可访问的信息
export interface ComponentContext {
    // 基础渲染能力
    render: (template: string, context?: Partial<ComponentContext>) => Promise<SendContent>;

    // 数据访问（只读）
    props: Readonly<Dict>;

    // 父组件上下文（只读）
    parent?: Readonly<ComponentContext>;

    // 根模板（只读）
    root: string;

    // 子组件内容（React 概念）
    children?: string;
    getValue: (template: string) => any;
    compile: (template: string) => string;
}

// 组件定义函数 - 简化版，只支持函数式组件
export function defineComponent<P = any>(
    component: Component<P>,
    name: string = component.name
): Component<P> {
    if (name) {
        // 创建一个新的函数来避免修改只读属性
        const namedComponent = component as Component<P>;
        Object.defineProperty(namedComponent, 'name', {
            value: name,
            writable: false,
            enumerable: false,
            configurable: true
        });
        return namedComponent;
    }
    return component;
}

// 组件匹配函数
export function matchComponent<P = any>(comp: Component<P>, template: string): string {
    // 使用更复杂的正则表达式来正确处理大括号内的内容
    const selfClosingRegex = new RegExp(`<${comp.name}((?:[^>]|{[^}]*})*)?/>`);
    const closingRegex = new RegExp(`<${comp.name}((?:[^>]|{[^}]*})*)?>([^<]*?)</${comp.name}>`);

    let match = template.match(selfClosingRegex);
    if (!match) {
        match = template.match(closingRegex);
    }

    return match ? match[0] : '';
}

// 属性解析函数 - 支持 children
export function getProps<P = any>(comp: Component<P>, template: string, context?: ComponentContext): P {
    // 1. 首先匹配组件标签，支持自闭合和闭合标签
    const selfClosingRegex = new RegExp(`<${comp.name}((?:[^>]|{[^}]*})*)?/>`);
    const closingRegex = new RegExp(`<${comp.name}((?:[^>]|{[^}]*})*)?>([^<]*?)</${comp.name}>`);

    let match = template.match(selfClosingRegex);
    let isSelfClosing = true;
    let children = '';

    if (!match) {
        match = template.match(closingRegex);
        isSelfClosing = false;
        if (match) {
            children = match[2] || '';
        }
    }

    if (!match) {
        return {} as P;
    }

    const attributesString = match[1] || '';

    // 2. 解析属性，支持多种格式
    const props: Record<string, any> = {};

    // 如果有属性字符串，解析属性
    if (attributesString.trim()) {
        // 使用手动解析来处理复杂的嵌套结构
        let i = 0;
        while (i < attributesString.length) {
            // 跳过空白字符
            while (i < attributesString.length && /\s/.test(attributesString[i])) {
                i++;
            }

            if (i >= attributesString.length) break;

            // 解析属性名
            let key = '';
            while (i < attributesString.length && /[a-zA-Z0-9_$\-]/.test(attributesString[i])) {
                key += attributesString[i];
                i++;
            }

            if (!key) {
                i++;
                continue;
            }

            // 跳过空白字符
            while (i < attributesString.length && /\s/.test(attributesString[i])) {
                i++;
            }

            // 检查是否有等号
            if (i < attributesString.length && attributesString[i] === '=') {
                i++; // 跳过等号

                // 跳过空白字符
                while (i < attributesString.length && /\s/.test(attributesString[i])) {
                    i++;
                }

                if (i >= attributesString.length) {
                    props[key] = true;
                    break;
                }

                // 解析属性值
                const value = parseAttributeValue(attributesString, i, context);
                props[key] = value.value;
                i = value.nextIndex;
            } else {
                // 没有等号，是布尔属性
                props[key] = true;
            }
        }
    }

    // 3. 处理 children（如果不是自闭合标签）
    if (!isSelfClosing && children.trim()) {
        props.children = children;
    }

    // 4. 处理 kebab-case 到 camelCase 的转换
    const camelCaseProps: Record<string, any> = {};
    for (const [key, value] of Object.entries(props)) {
        const camelKey = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        camelCaseProps[camelKey] = value;
    }

    return camelCaseProps as P;
}

/**
 * 解析属性值
 */
function parseAttributeValue(str: string, startIndex: number, context?: ComponentContext): { value: any; nextIndex: number } {
    let i = startIndex;

    // 处理引号包围的字符串
    if (str[i] === '"' || str[i] === "'") {
        const quote = str[i];
        i++; // 跳过开始引号
        let value = '';

        while (i < str.length && str[i] !== quote) {
            if (str[i] === '\\' && i + 1 < str.length) {
                // 处理转义字符
                i++;
                value += str[i];
            } else {
                value += str[i];
            }
            i++;
        }

        if (i < str.length) {
            i++; // 跳过结束引号
        }

        return { value, nextIndex: i };
    }

    // 处理大括号包围的表达式
    if (str[i] === '{') {
        let braceCount = 0;
        let value = '';
        i++; // 跳过开始大括号

        while (i < str.length) {
            if (str[i] === '{') {
                braceCount++;
            } else if (str[i] === '}') {
                if (braceCount === 0) {
                    i++; // 跳过结束大括号
                    break;
                }
                braceCount--;
            }
            value += str[i];
            i++;
        }

        return { value: parseExpressionValue(value, context), nextIndex: i };
    }

    // 处理无引号的值
    let value = '';
    while (i < str.length && !/\s/.test(str[i]) && str[i] !== '>') {
        value += str[i];
        i++;
    }

    return { value: parseUnquotedValue(value, context), nextIndex: i };
}

/**
 * 解析表达式值
 */
function parseExpressionValue(expr: string, context?: ComponentContext): any {
    expr = expr.trim();

    // 处理字符串字面量
    if ((expr.startsWith('"') && expr.endsWith('"')) ||
        (expr.startsWith("'") && expr.endsWith("'"))) {
        return expr.slice(1, -1);
    }

    // 处理数字
    if (/^-?\d+(\.\d+)?$/.test(expr)) {
        return parseFloat(expr);
    }

    // 处理布尔值
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (expr === 'undefined') return undefined;

    // 处理数组
    if (expr.startsWith('[') && expr.endsWith(']')) {
        try {
            return JSON.parse(expr);
        } catch {
            // 如果JSON解析失败，尝试手动解析简单数组
            const items = expr.slice(1, -1).split(',').map(item =>
                parseExpressionValue(item.trim(), context)
            );
            return items;
        }
    }

    // 处理对象 - 改进的嵌套大括号处理
    if (expr.startsWith('{') && expr.endsWith('}')) {
        try {
            return JSON.parse(expr);
        } catch {
            // 如果JSON解析失败，尝试手动解析简单对象
            try {
                return parseSimpleObject(expr);
            } catch {
                // 如果都失败，返回原始字符串
                return expr;
            }
        }
    }

    // 处理表达式 - 在沙盒中执行
    if (context) {
        try {
            const result = context.getValue(expr);
            return result !== undefined ? result : expr;
        } catch (error) {
            // 如果执行失败，返回原始表达式
            return expr;
        }
    }

    // 如果没有上下文，返回原始表达式
    return expr;
}

/**
 * 解析简单对象（处理嵌套大括号和方括号）
 */
function parseSimpleObject(objStr: string): any {
    const result: any = {};
    let i = 1; // 跳过开始的 {
    let depth = 0;
    let bracketDepth = 0;
    let key = '';
    let value = '';
    let inKey = true;
    let inString = false;
    let stringChar = '';

    while (i < objStr.length - 1) { // 跳过结束的 }
        const char = objStr[i];

        if (!inString) {
            if (char === '{') {
                depth++;
                value += char;
            } else if (char === '}') {
                depth--;
                value += char;
            } else if (char === '[') {
                bracketDepth++;
                value += char;
            } else if (char === ']') {
                bracketDepth--;
                value += char;
            } else if (char === ':' && depth === 0 && bracketDepth === 0) {
                inKey = false;
                i++;
                continue;
            } else if (char === ',' && depth === 0 && bracketDepth === 0) {
                // 处理键值对
                if (key.trim() && value.trim()) {
                    const parsedValue = parseExpressionValue(value.trim());
                    result[key.trim()] = parsedValue;
                }
                key = '';
                value = '';
                inKey = true;
                i++;
                continue;
            } else if (char === '"' || char === "'") {
                inString = true;
                stringChar = char;
                if (inKey) {
                    key += char;
                } else {
                    value += char;
                }
            } else {
                if (inKey) {
                    key += char;
                } else {
                    value += char;
                }
            }
        } else {
            if (char === stringChar) {
                inString = false;
            }
            if (inKey) {
                key += char;
            } else {
                value += char;
            }
        }
        i++;
    }

    // 处理最后一个键值对
    if (key.trim() && value.trim()) {
        const parsedValue = parseExpressionValue(value.trim());
        result[key.trim()] = parsedValue;
    }

    return result;
}

/**
 * 解析无引号的值
 */
function parseUnquotedValue(value: string, context?: ComponentContext): any {
    // 检查是否是大括号表达式
    if (value.startsWith('{') && value.endsWith('}')) {
        const expr = value.slice(1, -1); // 移除大括号
        return parseExpressionValue(expr, context);
    }

    // 处理布尔值
    if (value === 'true') return true;
    if (value === 'false') return false;

    // 处理数字
    if (/^-?\d+(\.\d+)?$/.test(value)) {
        return parseFloat(value);
    }

    // 处理 null/undefined
    if (value === 'null') return null;
    if (value === 'undefined') return undefined;

    // 其他情况作为字符串处理
    return value;
}

// 创建组件上下文的工厂函数
export function createComponentContext(
    props: Dict = {},
    parent?: ComponentContext,
    root: string = ''
): ComponentContext {
    return {
        // 基础渲染能力
        render: async (template: string, context?: Partial<ComponentContext>) => {
            // 这里需要实现渲染逻辑
            return template;
        },

        // 数据访问（只读）
        props: Object.freeze({ ...props }),

        // 父组件上下文（只读）
        parent: parent ? Object.freeze(parent) : undefined,

        // 根模板（只读）
        root,


        // 子组件内容（React 概念）
        children: undefined,
        getValue: (template: string) => getValueWithRuntime(template, props),
        compile: (template: string) => compiler(template, props),
    };
}
export function renderComponent<P = any>(component: Component<P>, template: string, context: ComponentContext): Promise<SendContent> {
    const props = getProps(component, template, context);
    return component(props, context);
}
// 渲染函数 - 支持新的组件系统
export async function renderComponents(
    componentMap: Map<string, Component>,
    options: SendOptions,
): Promise<SendOptions> {
    if (!componentMap.size) return options;

    const components = [...Array.from(componentMap.values()), Fetch, Fragment];


    // 创建根上下文
    const rootContext = createComponentContext(
        options,
        undefined,
        segment.toString(options.content)
    );

    // 实现渲染逻辑
    const renderWithContext = async (template: string, context: ComponentContext): Promise<SendContent> => {
        let result = template;

        // 编译模板
        result = context.compile(result);

        // 查找并渲染组件
        for (const comp of components) {
            const match = matchComponent(comp, result);
            if (match) {
                const rendered = await renderComponent(comp, match, context);
                result = result.replace(match, segment.toString(rendered));
                break; // 一次只处理一个组件
            }
        }

        return result;
    };

    // 更新根上下文的渲染函数
    rootContext.render = async (template: string, context?: Partial<ComponentContext>) => {
        return await renderWithContext(template, rootContext);
    };

    // 渲染模板
    const output = await renderWithContext(rootContext.root, rootContext);
    const content = segment.from(output);

    return {
        ...options,
        content
    };
}

// 内置组件
export const Fragment = defineComponent(async (props: { children?: SendContent }, context: ComponentContext) => {
    // Fragment 直接渲染 children，不添加任何包装
    return context.render(segment.toString(props.children || ''), context);
}, 'Fragment');
export const Fetch = defineComponent(async ({ url }) => {
    const result: string = await fetch(url).then((r) => r.text());
    return result;
}, 'fetch');
