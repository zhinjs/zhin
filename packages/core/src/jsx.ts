import { MaybePromise } from '@zhin.js/types';
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
        interface Element extends MessageComponent<any> {}
        interface ElementClass {
            render(props: any, context?: ComponentContext): MaybePromise<SendContent>;
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
    }
}

// JSX 运行时函数
export function jsx(type: JSXElementType, data: JSXProps): MessageElement {
    return {
        type,
        data,
    } as MessageElement;
}

// JSX Fragment 支持
export function jsxs(type: JSXElementType, props: JSXProps): MessageElement {
    return jsx(type, props);
}


// JSX 渲染函数
export async function renderJSX(element: MessageComponent<any>, context?: ComponentContext): Promise<SendContent> {
    if (typeof element.type === 'string') {
        if (element.type === 'Fragment') {
            return await renderChildren(element.data.children, context);
        }
        // 其他内置组件处理
        return await renderChildren(element.data.children, context);
    } else if (typeof element.type === 'function') {
        // 函数组件
        const component = element.type as Component<any>;
        return await component(element.data, context || {} as ComponentContext);
    } else {
        // 类组件或其他类型
        const component = element.type as Component<any>;
        return await component(element.data, context || {} as ComponentContext);
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
            return '';
        }));
        return results.join('');
    }
    if (children && typeof children === 'object' && 'type' in children) {
        return await renderJSX(children as MessageComponent<any>, context);
    }
    return '';
}
