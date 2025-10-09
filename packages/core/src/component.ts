import {getValueWithRuntime, compiler, segment} from './utils.js';
import {Dict, SendContent, SendOptions} from './types.js';
import {Message} from "./message.js";
import {MaybePromise} from "@zhin.js/types";
export const CapWithChild = Symbol('CapWithChild');
export const CapWithClose = Symbol('CapWithClose');
/**
 * Component类：消息组件系统核心，支持模板渲染、属性解析、循环等。
 * 用于自定义消息结构和复用UI片段。
 * @template T 组件props类型
 * @template D 组件data类型
 * @template P 组件props配置类型
 */
export class Component<T = {}, D = {}, P = Component.Props<T>> {
    [CapWithClose]: RegExp;
    [CapWithChild]: RegExp;
    $props: Component.PropConfig[] = [];
    get name(){
        return this.$options.name;
    }
    set name(value:string){
        this.$options.name=value;
    }
    /**
     * 构造函数：初始化组件，生成属性正则
     * @param $options 组件配置项
     */
    constructor(private $options: Component.Options<T, D, P>) {
        this.formatProps();
        this[CapWithChild] = new RegExp(`<${$options.name}([^>]*)?>([^<])*?</${$options.name}>`);
        this[CapWithClose] = new RegExp(`<${$options.name}([^>]*)?/>`);
    }
    /**
     * 判断模板是否为自闭合标签
     * @param template 模板字符串
     */
    isClosing(template: string) {
        return this[CapWithClose].test(template);
    }
    /**
     * 匹配组件标签
     * @param template 模板字符串
     * @returns 匹配到的标签内容
     */
    match(template: string) {
        let [match] = this[CapWithChild].exec(template) || [];
        if (match) return match;
        [match] = this[CapWithClose].exec(template) || [];
        return match;
    }
    /**
     * 格式化props配置，生成props数组
     */
    private formatProps() {
        for (const [key, value] of Object.entries(this.$options.props || {})) {
            this.formatProp(key, value as any);
        }
    }

    /**
     * 格式化单个prop配置
     * @param name 属性名
     * @param value 类型或配置
     */
    private formatProp(name: string, value: Exclude<Component.PropConfig, 'name'> | Component.TypeConstruct) {
        if (typeof value === 'function') {
            return this.$props.push({
                name,
                type: value,
                default: undefined,
            });
        }
        return this.$props.push({
            name,
            type: value.type,
            default: value.default,
        });
    }

    parseProps(template: string) {
        const result = Object.fromEntries(
            this.$props.map(prop => {
                const generateDefault = typeof prop.default === 'function' ? prop.default : () => prop.default;
                return [prop.name, generateDefault()];
            }),
        );
        const matchedArr = [...template.matchAll(/([a-zA-Z\-:]+)\s*=\s*(['"])(.*?)\2/g)].filter(Boolean);
        if (!matchedArr.length) return result;
        for (const [_, key, __, value] of matchedArr) {
            Object.defineProperty(result, key, {
                enumerable: true,
                writable: false,
                value,
            });
        }
        return result;
    }
    parseChildren(template: string): string {
        if (this.isClosing(template)) return '';
        const matched = template.match(/<[^>]+>([^<]*?)<\/[^?]+>/);
        if (!matched) return '';
        return matched[1];
    }
    async render(template: string, context: Component.Context): Promise<SendContent> {
        const props = this.parseProps(template);
        const assignValue = () => {
            for (const key of keys) {
                if (!key.startsWith(':')) continue;
                Object.defineProperty(props, key.slice(1), {
                    value: getValueWithRuntime(Reflect.get(props, key), context.parent),
                });
                Reflect.deleteProperty(props, key);
            }
        };
        const keys = Object.keys(props).map(key => {
            const newKey = key.replace(/(\w)+-(\w)/g, function (_, char, later) {
                return `${char}${later.toUpperCase()}`;
            });
            if (key !== newKey) {
                Object.defineProperty(props, newKey, {
                    value: Reflect.get(props, key),
                    enumerable: true,
                });
                Reflect.deleteProperty(props, key);
            }
            return newKey;
        });
        assignValue();
        const data = this.$options.data ? this.$options.data.apply(props as P) : ({} as D);
        for (const key of keys) {
            if (key === 'vFor') {
                const { 'vFor': expression, 'v-for': _, ...rest } = props as any;
                const { name, value, ...other } = Component.fixLoop(expression);
                const list = value === '__loop__' ? other[value] : getValueWithRuntime(value, context);
                const fnStr = `
                const result=[];\n
                for(const ${name} of list){\n
                  result.push(render(props,{\n
                    ...context,\n
                    children:'',\n
                    $origin:'${template.replace(/'/g, "'")}',
                    parent:{\n
                      ...context.parent,\n
                      ${name}:list[${name}]
                    }\n
                  }))\n
                }
                return result;`;
                const fn = new Function('render,list,props,context', fnStr);
                const newTpl = template
                    .replace(`v-for="${expression}"`, '')
                    .replace(`v-for='${expression}'`, '')
                    .replace(`vFor="${expression}"`, '')
                    .replace(`vFor='${expression}'`, '');
                return (await Promise.all(fn(this.render.bind(this), list, newTpl, context))).join('');
            }
            if (key === 'vIf') {
                const needRender = getValueWithRuntime(Reflect.get(props as object, 'vIf'), context);
                if (!needRender) return '';
            }
        }
        context.children = this.parseChildren(template) || context.children;
        const ctx = {
            $slots: context.$slots || {},
            ...props,
            ...data,
            $message: context.$message,
            render: context.render,
            parent: context,
            children: context.children,
        } as Component.Context<D & P>;
        const result = segment.toString(await this.$options.render(props as P, ctx));
        context.$root = context.$root.replace(context.$origin || template,result.includes('<')?segment.escape(result):result);
        return context.render(context.$root, context);
    }
}
export function defineComponent<P>(render: Component.Render<P, {}>, name?: string): Component<{}, {}, P>;
export function defineComponent<T, D = {}, P = Component.Props<T>>(options: Component.Options<T, D>): Component<T, D, P>;
export function defineComponent<T = {}, D = {}, P = Component.Props<T>>(options: Component.Options<T, D, P> | Component.Render<P, D>, name = options.name) {
    if (typeof options === 'function')
        options = {
            name,
            render: options,
        };
    return new Component(options);
}

export namespace Component {
    export type TypeConstruct<T = any> = {
        new (): T;
        readonly prototype: T;
    };
    export type PropConfig<T extends TypeConstruct = TypeConstruct> = {
        name: string;
        type: T;
        default: Prop<T>;
    };

    export interface Options<T, D, P = Props<T>> {
        name: string;
        props?: T;
        data?: (this: P) => D;
        render: Render<P, D>;
    }

    export type Context<T = {}> = {
        $slots: Dict<Render<any, any>>;
        $message: Message;
        $origin?: string;
        $root: string;
        parent: Context;
        render(template: string, context: Context): Promise<SendContent>;
        children?: string;
    } & T;
    export type Render<P = {}, D = {}> = (props: P, context: Context<P & D>) => MaybePromise<SendContent>;
    export type Props<T> = {
        [P in keyof T]: Prop<T[P]>;
    };
    export type PropWithDefault<T> = {
        type: T;
        default?: DefaultValue<T>;
    };
    type DefaultValue<T> = T extends ObjectConstructor | ArrayConstructor ? () => Prop<T> : Prop<T>;
    export type Prop<T> = T extends BooleanConstructor
        ? boolean
        : T extends StringConstructor
            ? string
            : T extends NumberConstructor
                ? number
                : T extends ArrayConstructor
                    ? any[]
                    : T extends ObjectConstructor
                        ? Dict
                        : T extends PropWithDefault<infer R>
                            ? Prop<R>
                            : unknown;
    export const fixLoop = (loop: string) => {
        let [_, name, value] = /(\S+)\sin\s(\S+)/.exec(loop) || [];
        if (/\d+/.test(value))
            value = `[${new Array(+value)
                .fill(0)
                .map((_, i) => i)
                .join(',')}]`;
        if (/^\[.+]$/.test(value)) {
            return { name, value: '__loop__', __loop__: JSON.parse(value) };
        }
        return { name, value };
    };

    export async function render(componentMap:Map<string,Component>,options:SendOptions):Promise<SendOptions>{
        if(!componentMap.size) return options;
        const components=[
            ...componentMap.values(),
            Template,
            Slot,
        ]
        const createContext = (runtime: Dict = {}, parent: Component.Context, $root: string): Component.Context => {
            return {
                $slots: {},
                ...runtime,
                $message: parent.$message,
                $root,
                parent,
                render: (template: string, context) => {
                    return renderWithRuntime(template, context, context.$root);
                },
            };
        };
        const renderWithRuntime = async (template: string, runtime: Dict, $root: string):Promise<SendContent> => {
            const ctx = createContext(runtime, runtime as Component.Context, $root);
            template = compiler(template, runtime);
            for (const comp of components) {
                const match = comp.match(template);
                if (!match) continue;
                return await comp.render(match, ctx);
            }
            return template;
        };
        const template=segment.toString(options.content);
        const output=await renderWithRuntime(template, options, template)
        const content=segment.from(output)
        return {
            ...options,
            content
        };
    }

    export const Template=defineComponent({
        name: 'template',
        render(props, context) {
            const keys = Object.keys(props);
            if (!keys.length) keys.push('#default');
            for (const key of Object.keys(props)) {
                if (key.startsWith('#')) {
                    context.parent.$slots[key.slice(1)] = (async p => {
                        return await context.render(context.children || '', { ...context, ...p });
                    }) as Render;
                }
            }
            return '';
        },
    })
    export const Slot=defineComponent({
        name: 'slot',
        props: {
            name: String,
        },
        render({ name, ...props }, context) {
            name = name || 'default';
            if (!context.parent) return '';
            if (context.parent.$slots[name]) return context.parent.$slots[name](props, context) as string;
            return context.children || '';
        },
    })
}
process.on('unhandledRejection',e=>{
    // console.error 已替换为注释
})