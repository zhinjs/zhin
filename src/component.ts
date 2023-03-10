import {Random, Time} from "@zhinjs/shared";
import {Context} from "@/context";
import {Session} from "@/session";


export type DefineComponent<PropsOptions = Component.ObjectPropsOptions, D = {}, M extends Component.MethodOptions = {}, Props = Component.ExtractPropTypes<PropsOptions>> =
    Component.OptionsBase<Props, D, M>
    & {
    props?: PropsOptions & ThisType<void>;
} & ThisType<Component.Runtime<Props, D, M>>;

export function defineComponent<PropsOptions extends Component.ComponentPropsOptions, D, M extends Component.MethodOptions = {}>(options: DefineComponent<PropsOptions, D, M>): DefineComponent<PropsOptions, D, M> {
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

    interface PropOptions<T = any, D = T> {
        type?: PropType<T> | true | null;
        required?: boolean;
        default?: D | DefaultFactory<D> | null | undefined | object;

        validator?(value: unknown): boolean;
    }

    type DefaultFactory<T> = (props: Data) => T | null | undefined;
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
    export type Prop<T, D = T> = PropOptions<T, D> | PropType<T>;
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
    }] ? U extends DateConstructor ? Date | InferPropType<U> : InferPropType<U> : [T] extends [Prop<infer V, infer D>] ? unknown extends V ? IfAny<V, V, D> : V : T;

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
        render: Function
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
                    return this.execute(children)
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
