import { SendContent } from './types.js';
import { Component,ComponentContext } from './component.js';
import { MessageElement } from './types.js';

declare global {
    namespace JSX {
        interface Element {
            type: string | Component<any>;
            data: Record<string, any>;
            children?: JSXChildren;
        }

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
            // 简化的组件元素
            fetch: JSXFetchElement;
        }
    }
}

// 简化的组件属性接口
interface JSXBaseElement {
    children?: JSXChildren;
}

interface JSXFetchElement extends JSXBaseElement {
    url?: string;
}

// JSX 子元素类型
type JSXChildren = MessageElement | string | number | boolean | null | undefined | JSXChildren[];

// JSX 元素类型
type JSXElement = {
    type: string | Component<any>;
    data: Record<string, any>;
    children?: JSXChildren;
};

// 类型辅助
type MaybePromise<T> = T | Promise<T>;
