import {Awaitable, Dict} from "./types";
import {Session} from "./session";
import Element, {Fragment} from "./element";
import {Context} from "@/context";
import {Random, Time} from "@/utils";

export type Component<A extends Dict=Dict,T extends Awaitable<Fragment>=Awaitable<Element.Fragment>> = Component.Options|Element.Render<Session,A,T>
export namespace Component {
    export const name='builtComponent'
    export interface Options<A extends Dict=Dict,C=Element,T=Awaitable<Element.Fragment>> {
        session?: boolean
        passive?: boolean
        render:Element.Render<Session,A,T>
    }
    const confirm:Component<{initial:boolean}>=async (attrs,children,session)=>{
       return (await session.prompt.confirm(children.join(''),attrs.initial))+''
    }
    export function install(ctx: Context) {
        // 内置组件
        ctx
            .component('confirm',confirm)
            .component('template', (attrs, children) => children.join(''))
            .component('execute', async (attrs, children, session) => {
                return await session.execute(children)
            }, {session: true})
            .component('prompt', async (attrs, children, session) => {
                return await session.prompt[attrs.type ||= 'text'](children.join(''), attrs)
            }, {session: true})
            .component('random', async (attrs, children, session) => {
                return Random.pick(children).toString()
            })
            .component('time', (attrs) => {
                let ms = attrs.value ? +attrs.value : Date.now()
                return Time.template(attrs.format || 'yyyy-MM-dd hh:mm:ss', new Date(ms))
            }, {session: true})
    }
}
