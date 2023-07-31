import { Awaitable, Random, Time } from "@zhinjs/shared";
import { Context } from "@/context";
import { Session } from "@/session";
import { Element, h } from "@/element";

export type DefineComponent<
    P = Component.ObjectPropsOptions,
    D = {},
    M extends Component.MethodOptions = {},
    PT = Component.ExtractPropTypes<P>,
> = Component.OptionsBase<PT, D, M> & {
    props?: P & ThisType<void>;
} & ThisType<Component.Runtime<PT, D, M>>;
export type FunctionalComponent<P = {}> = (
    this: Component.Runtime<P>,
    props: P,
    children: Element[],
) => Element.Fragment | Promise<Element.Fragment>;

export function defineComponent<
    P extends Component.ComponentPropsOptions,
    D,
    M extends Component.MethodOptions = {},
>(options: DefineComponent<P, D, M> | FunctionalComponent): DefineComponent<P, D, M> {
    if (typeof options === "function")
        options = {
            render: options,
        };
    return options;
}

export interface Component extends DefineComponent<any, any, any> {}

export namespace Component {
    export const name = "builtComponent";
    export const type = "built";
    type Data = Record<string, unknown>;

    export type ObjectPropsOptions<P = Data> = {
        [K in keyof P]: Prop<P[K]> | null;
    };

    type PropConstructor<T = any> =
        | {
              new (...args: any[]): T & {};
          }
        | {
              (): T;
          }
        | PropMethod<T>;

    type PropMethod<T, TConstructor = any> = [T] extends [((...args: any) => any) | undefined]
        ? {
              new (): TConstructor;
              (): T;
              readonly prototype: TConstructor;
          }
        : never;

    export type PropType<T> = PropConstructor<T> | PropConstructor<T>[];
    export type Prop<T> = PropType<T>;
    export type ComponentPropsOptions<P = Data> = ObjectPropsOptions<P> | string[];

    export interface MethodOptions {
        [key: string]: Function;
    }

    type RequiredKeys<T> = {
        [K in keyof T]: T[K] extends
            | {
                  required: true;
              }
            | {
                  default: any;
              }
            | BooleanConstructor
            | {
                  type: BooleanConstructor;
              }
            ? T[K] extends {
                  default: undefined | (() => undefined);
              }
                ? never
                : K
            : never;
    }[keyof T];

    type OptionalKeys<T> = Exclude<keyof T, RequiredKeys<T>>;
    export type ExtractPropTypes<O> = {
        [K in keyof Pick<O, RequiredKeys<O>>]: InferPropType<O[K]>;
    } & {
        [K in keyof Pick<O, OptionalKeys<O>>]?: InferPropType<O[K]>;
    };

    type InferPropType<T> = [T] extends [null]
        ? any
        : [T] extends [
              {
                  type: null | true;
              },
          ]
        ? any
        : [T] extends [
              | ObjectConstructor
              | {
                    type: ObjectConstructor;
                },
          ]
        ? Record<string, any>
        : [T] extends [
              | BooleanConstructor
              | {
                    type: BooleanConstructor;
                },
          ]
        ? boolean
        : [T] extends [
              | DateConstructor
              | {
                    type: DateConstructor;
                },
          ]
        ? Date
        : [T] extends [
              | (infer U)[]
              | {
                    type: (infer U)[];
                },
          ]
        ? U extends DateConstructor
            ? Date | InferPropType<U>
            : InferPropType<U>
        : T;

    export type IfAny<T, Y, N> = 0 extends 1 & T ? Y : N;

    interface LegacyOptions<Props, D, M extends MethodOptions> {
        data?: (this: Runtime<Props, {}, MethodOptions>) => D;
        methods?: M;
    }

    export type Runtime<P = {}, D = {}, M extends MethodOptions = {}> = RuntimeContext<M> & D & P;

    export declare type RuntimeContext<M extends MethodOptions = {}> = {
        session: Session;
    } & M;

    export interface OptionsBase<Props, D, M extends MethodOptions>
        extends LegacyOptions<Props, D, M> {
        render(
            this: Component.Runtime<Props, D, M>,
            props: Props,
            children: Element[],
        ): Awaitable<Element.Fragment>;
    }

    export function createRuntime(old: Runtime, component: Component, attrs) {
        const { data: dataInitFunc = () => ({}), methods = {} } = component;
        const runtime = Object.assign(old, attrs);
        Object.keys(methods).forEach(key => {
            if (typeof methods[key] === "function") {
                runtime[key] = methods[key].bind(runtime);
            }
        });
        const data = dataInitFunc.apply(runtime);
        return Object.assign(runtime, data);
    }

    // 内置组件
    export function install(ctx: Context) {
        // 模板解析
        ctx.component(async function template(attrs, children) {
            return await this.session.render(children, this);
        })
            // 执行指令
            .component(async function execute(attrs, children) {
                const template = (await this.session.render(children, this)).join("");
                return this.session.execute(template);
            })
            // 转发
            .component(async function forward(
                attrs: {
                    user_id?: string | number;
                    user_name?: string;
                },
                children,
            ) {
                return h("node", {
                    user_id: attrs.user_id || this.session.user_id,
                    user_name: attrs.user_name || this.session.user_name,
                    children: Element.toElementArray(await this.session.render(children, this)),
                });
            })
            // 提示输入基础能力
            .component(async function prompt(
                props: {
                    type?: string;
                    options?: string;
                },
                children,
            ) {
                if (props.options) {
                    props.options = props.options.startsWith(":")
                        ? props.options.slice(1)
                        : props.options;
                    props.options = new Function(`return (${props.options})`)();
                }
                return await this.session.prompt[this.type || "text"](children.join(""), props);
            })
            // 随机输出
            .component(function random(attrs, children) {
                return Random.pick(children);
            })
            // 时间格式化
            .component(function time(props: { value?: number; format?: string }) {
                let ms = props.value || Date.now();
                return Time.template(props.format || "yyyy-MM-dd hh:mm:ss", new Date(ms));
            });
    }
}
