import {Random, Time,Dict} from "@zhinjs/shared";
import {Element,h} from "./element";
import {Context} from "@/context";
import {Session} from "@/session";

export type Component<
    S=any,
    P extends Dict = Dict,
    D extends Dict = Dict,
    M extends Dict=Dict
> = ({
    [K in keyof (P | D | M)]: K extends keyof P ? P[K] : K extends keyof D ? D[K] : M[K]
} & {
    render: Component.Render<S & M & D,P>
})
export type DefineComponent<S=any,
    M extends Dict<Function>=Dict<Function>,
    P extends Component.PropsDesc = Component.PropsDesc,
    D extends Component.InitFunc<Dict> = Component.InitFunc<Dict>
> = Component.InitOption<S,M,P,D>

export function defineComponent<S,
M extends Dict<Function>=Dict<Function>,
    P extends Component.PropsDesc = Component.PropsDesc,
    D extends Component.InitFunc<Dict> = Component.InitFunc<Dict>
>(component: DefineComponent<
    S & M,
    M,
    P,
    D
>): DefineComponent<S,M,P, D> {
    return component
}

export namespace Component {
    export type Runtime<S,P extends Component.PropsDesc = Component.PropsDesc,
        D extends Component.InitFunc<Dict> = Component.InitFunc<Dict>> = S & PropsType<P> & DataType<D>
    export const name = 'builtComponent'
    export interface Method<S,P={}, D ={}>{
        (this:S & P & D):any
    }
    export type InitFunc<T = any> = (this: Component) => T
    type PropType = string | number | boolean | object | any[]
    type ValueDescObj<T extends PropType = PropType> = {
        type: new(...args: any[]) => T
        validator?(this: Component, value: unknown): boolean
        default?: T | InitFunc<T>
    }
    type ValueDesc = (new(...args: any[]) => PropType) | ValueDescObj
    export type PropsDesc = Record<string, ValueDesc>
    export type Methods<C> = Dict<Method<C>>
    export type DataType<D extends InitFunc> = D extends InitFunc<infer R>?R:unknown
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
    }[keyof T]
    type OptionalKeys<T> = Exclude<keyof T, RequiredKeys<T>>
    type InferPropType<O extends ValueDesc> = O extends { new(...args: any[]): infer R } ? R : O extends ValueDescObj<infer R> ? R : unknown
    export declare type ExtractPropTypes<O extends PropsDesc> = {
        [K in keyof Pick<O, RequiredKeys<O>>]: InferPropType<O[K]>;
    } & {
        [K in keyof Pick<O, OptionalKeys<O>>]?: InferPropType<O[K]>;
    };
    export type PropsType<O extends PropsDesc> = ExtractPropTypes<O>

    export interface InitOption<S,M extends Dict<Function>,P extends PropsDesc, D extends InitFunc<Dict>> {
        props?: P
        data?: D
        methods?: M
        render: Render<S & M & DataType<D>,PropsType<P>>
    }

    export type Render<S,P extends Dict> = Element.Render<S & P, P>
    export function createRuntime<S>(session:S,options:InitOption<S, {  },{},()=>{}>,attrs){
        const {data:dataInitFunc=()=>({}),methods={}}=options
        const runtime=Object.assign(session,attrs)
        Object.keys(methods).forEach(key=>{
            if(typeof methods[key]==='function'){
                runtime[key]=methods[key].bind(runtime)
            }
        })
        const data=dataInitFunc.apply(runtime)
        return Object.assign(runtime,data)
    }
    export function install(ctx: Context) {
        // 内置组件
        ctx
            .component('template', defineComponent<Session>({
                render(attrs, children){
                    return children
                }
            }))
            .component('execute', defineComponent<Session>({
                render(attrs, children) {
                    return this.execute(children)
                }
            }))
            .component('prompt', defineComponent<Session>({
                props: {
                    type: String
                },
                async render(props, children) {
                    return await this.prompt[this.type ||= 'text'](children.join(''), props)
                }
            }))
            .component('random', defineComponent<Session>({
                async render(attrs, children) {
                    return Random.pick(children)
                }
            }))
            .component('time', defineComponent<Session>({
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
