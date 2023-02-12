import {Random, Time,Dict} from "@zhinjs/shared";
import {Element} from "./element";
import {Context} from "@/context";

export type Component<S=any,P extends Dict = Dict, D extends Dict = Dict, M extends Component.Methods = Component.Methods> = ({
    [K in keyof (P | D | M)]: K extends keyof P ? P[K] : K extends keyof D ? D[K] : M[K]
} & {
    render: Component.Render<S,P, D, M>
})
export type DefineComponent<S=any,P extends Component.PropsDesc = Component.PropsDesc, D extends Component.InitFunc<Dict> = Component.InitFunc<Dict>, M extends Component.Methods = Component.Methods> = Component.InitOption<S,P, D, M>

export function defineComponent<S=any,P extends Component.PropsDesc = Component.PropsDesc, D extends Component.InitFunc<Dict> = Component.InitFunc<Dict>, M extends Component.Methods = Component.Methods>(component: DefineComponent<S,P, D, M>): DefineComponent<S,P, D, M> {
    return component
}

export namespace Component {
    export const name = 'builtComponent'
    export type InitFunc<T = any> = (this: Component) => T
    type PropType = string | number | boolean | object | any[]
    type ValueDescObj<T extends PropType = PropType> = {
        type: new(...args: any[]) => T
        validator?(this: Component, value: unknown): boolean
        default?: T | InitFunc<T>
    }
    type ValueDesc = (new(...args: any[]) => PropType) | ValueDescObj
    export type PropsDesc = Record<string, ValueDesc>
    export type Methods = Dict<InitFunc>
    type DataType<D extends Dict> = D
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

    export interface InitOption<S,P extends PropsDesc, D extends InitFunc<Dict>, M extends Methods> {
        props?: P
        data?: D
        methods?: M
        render: Render<S,PropsType<P>, DataType<D>, M>
    }

    export type Render<S,P extends Dict, D extends Dict, M extends Dict> = Element.Render<S & P & D & M, P>

    export function install(ctx: Context) {
        // 内置组件
        ctx
            .component('template', (attrs, children) => children)
            .component('execute', defineComponent({
                render(attrs, children) {
                    return this.execute(children)
                }
            }))
            .component('prompt', defineComponent({
                props: {
                    type: String
                },
                data() {
                    return {args: []}
                },
                async render(props, children) {
                    return await this.prompt[this.type ||= 'text'](children.join(''), props)
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
                    // @ts-ignore
                    return Time.template(this.format || 'yyyy-MM-dd hh:mm:ss', new Date(ms))
                }
            }))
    }
}
