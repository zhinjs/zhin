import { SendContent,MessageElement } from './types.js';
import { MessageComponent } from './message.js';
import { Component, ComponentContext } from './component.js';


// JSX 子元素类型
export type JSXChildren = MessageElement | string | number | boolean | null | undefined | JSXChildren[];

// JSX 元素类型
export type JSXElementType = string | Component<any> ;

// JSX 属性类型
export type JSXProps = Record<string, any> & {
    children?: JSXChildren;
};
export {Fragment} from './component.js'
// 全局 JSX 命名空间
declare global {
    namespace JSX {
        // 支持同步和异步组件 - Element 可以是 MessageComponent
        // TypeScript 会在编译时允许异步组件，运行时会自动 await
        type Element = SendContent | Promise<SendContent>
        interface ElementClass {
            render(props: any, context?: ComponentContext): Element;
        }
        interface ElementAttributesProperty {
            data: {};
        }
        interface ElementChildrenAttribute {
            children: {};
        }
        interface IntrinsicElements {
            [elemName: string]: any;
        }
        // 添加对异步组件的支持
        interface IntrinsicAttributes {
            key?: string | number;
        }
    }
}

// JSX 运行时函数 - 支持异步组件
export function jsx(type: JSXElementType, data: JSXProps): MessageComponent<any> {
    return {
        type,
        data,
    } as MessageComponent<any>;
}

// JSX Fragment 支持
export function jsxs(type: JSXElementType, props: JSXProps): MessageElement {
    return jsx(type, props);
}


// JSX 渲染函数
export async function renderJSX(element: MessageComponent<any>, context?: ComponentContext): Promise<SendContent> {
    try {
        if (typeof element.type === 'string') {
            if (element.type === 'Fragment') {
                return await renderChildren(element.data.children, context);
            }
            // 其他内置组件处理
            return await renderChildren(element.data.children, context);
        } else if (typeof element.type === 'function') {
            // 函数组件
            const component = element.type as Component<any>;
            const result = await component(element.data, context || {} as ComponentContext);
            
            // 如果组件返回 Promise，自动 await
            if (result && typeof result === 'object' && 'then' in result) {
                return await result;
            }
            
            return result;
        } else {
            // 类组件或其他类型
            const component = element.type as Component<any>;
            const result = await component(element.data, context || {} as ComponentContext);
            
            // 如果组件返回 Promise，自动 await
            if (result && typeof result === 'object' && 'then' in result) {
                return await result;
            }
            
            return result;
        }
    } catch (error) {
        // 渲染错误时返回错误信息
        const errorMessage = error instanceof Error ? error.message : String(error);
        return `❌ 组件渲染失败: ${errorMessage}`;
    }
}

// 渲染子元素
async function renderChildren(children: JSXChildren, context?: ComponentContext): Promise<SendContent> {
    if (children == null) return '';
    if (typeof children === 'string' || typeof children === 'number' || typeof children === 'boolean') {
        return String(children);
    }
    if (Array.isArray(children)) {
        const results = await Promise.all(children.map(async child => {
            if (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean') {
                return String(child);
            }
            if (child && typeof child === 'object' && 'type' in child) {
                return await renderJSX(child as MessageComponent<any>, context);
            }
            // 如果子元素是 Promise，自动 await
            if (child && typeof child === 'object' && 'then' in child) {
                try {
                    return await child;
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    return `❌ 组件渲染失败: ${errorMessage}`;
                }
            }
            return '';
        }));
        return results.join('');
    }
    if (children && typeof children === 'object' && 'type' in children) {
        return await renderJSX(children as MessageComponent<any>, context);
    }
    // 如果子元素是 Promise，自动 await
    if (children && typeof children === 'object' && 'then' in children) {
        try {
            return await children;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return `❌ 组件渲染失败: ${errorMessage}`;
        }
    }
    return '';
}
