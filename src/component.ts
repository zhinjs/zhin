import {Awaitable, Random, Time} from "@zhinjs/shared";
import {Context} from "@/context";
import {Session} from "@/session";
import {Element} from "@/element";


export type DefineComponent<P = Component.ObjectPropsOptions, D = {}, M extends Component.MethodOptions = {}, PT = Component.ExtractPropTypes<P>> =
    Component.OptionsBase<PT, D, M>
    & {
    props?: P & ThisType<void>;
} & ThisType<Component.Runtime<PT, D, M>>;

export function defineComponent<P extends Component.ComponentPropsOptions, D, M extends Component.MethodOptions = {}>(options: DefineComponent<P, D, M>): DefineComponent<P, D, M> {
    return options
}

export interface Component extends DefineComponent<any, any, any> {
}

export namespace Component {
    export const name = 'builtComponent'
    type Data = Record<string, unknown>;

    export type ObjectPropsOptions<P = Data> = {
        [K in keyof P]: Prop<P[K]> | null;
    };

    type PropConstructor<T = any> = {
        new(...args: any[]): T & {};
    } | {
        (): T;
    } | PropMethod<T>;

    type PropMethod<T, TConstructor = any> = [T] extends [
            ((...args: any) => any) | undefined
    ] ? {
        new(): TConstructor;
        (): T;
        readonly prototype: TConstructor;
    } : never;

    export type PropType<T> = PropConstructor<T> | PropConstructor<T>[];
    export type Prop<T> =PropType<T>;
    export type ComponentPropsOptions<P = Data> = ObjectPropsOptions<P> | string[];

    export interface MethodOptions {
        [key: string]: Function;
    }

    type RequiredKeys<T> = {
        [K in keyof T]: T[K] extends {
            required: true;
        } | {
            default: any;
        } | BooleanConstructor | {
            type: BooleanConstructor;
        } ? T[K] extends {
            default: undefined | (() => undefined);
        } ? never : K : never;
    }[keyof T];

    type OptionalKeys<T> = Exclude<keyof T, RequiredKeys<T>>;
    export type ExtractPropTypes<O> = {
        [K in keyof Pick<O, RequiredKeys<O>>]: InferPropType<O[K]>;
    } & {
        [K in keyof Pick<O, OptionalKeys<O>>]?: InferPropType<O[K]>;
    };

    type InferPropType<T> = [T] extends [null] ? any : [T] extends [{
        type: null | true;
    }] ? any : [T] extends [ObjectConstructor | {
        type: ObjectConstructor;
    }] ? Record<string, any> : [T] extends [BooleanConstructor | {
        type: BooleanConstructor;
    }] ? boolean : [T] extends [DateConstructor | {
        type: DateConstructor;
    }] ? Date : [T] extends [(infer U)[] | {
        type: (infer U)[];
    }] ? U extends DateConstructor ? Date | InferPropType<U> : InferPropType<U> : T;

    export type IfAny<T, Y, N> = 0 extends 1 & T ? Y : N;

    interface LegacyOptions<Props, D, M extends MethodOptions> {
        data?: (this: Runtime<Props, {}, MethodOptions>) => D;
        methods?: M;
    }

    export type Runtime<P = {}, D = {}, M extends MethodOptions = {}> = RuntimeContext<M> & D & P;

    export declare type RuntimeContext<M extends MethodOptions = {}> =
        {
            session: Session
        }
        & M;

    export interface OptionsBase<Props, D, M extends MethodOptions> extends LegacyOptions<Props, D, M> {
        render(this:Component.Runtime<Props, D, M>,props:Props,children:Element[]):Awaitable<Element.Fragment>
    }

    export function createRuntime(old: Runtime, component: Component, attrs) {
        const {data: dataInitFunc = () => ({}), methods = {}} = component
        const runtime = Object.assign(old, attrs)
        Object.keys(methods).forEach(key => {
            if (typeof methods[key] === 'function') {
                runtime[key] = methods[key].bind(runtime)
            }
        })
        const data = dataInitFunc.apply(runtime)
        return Object.assign(runtime, data)
    }

    export function install(ctx: Context) {
        // 内置组件
        ctx
            .component('template', defineComponent({
                render(attrs, children) {
                    return children
                }
            }))
            .component('execute', defineComponent({
                render(attrs, children) {
                    return this.session.execute(children)
                }
            }))
            .component('prompt', defineComponent({
                props: {
                    type: String
                },
                async render(props, children) {
                    return await this.session.prompt[this.type ||= 'text'](children.join(''), props)
                }
            }))
            .component('random', defineComponent({
                async render(attrs, children) {
                    return Random.pick(children)
                }
            }))
            .component('time', defineComponent({
                props: {
                    value: Number,
                    format: String
                },
                render() {
                    let ms = this.value || Date.now()
                    return Time.template(this.format || 'yyyy-MM-dd hh:mm:ss', new Date(ms))
                }
            }))
    }
}