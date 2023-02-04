import {Awaitable, Dict} from "./types";
import {Session} from "./session";
import Element from "./element";
import {Context} from "@/context";
import {Random, Time} from "@/utils";

export type Component<A extends Dict=Dict,C=Element,T=Awaitable<Element.Fragment>> = Element.Render<Session,A,C,T>
export namespace Component {
    export const name='builtComponent'
    export interface Options {
        session?: boolean
        passive?: boolean
    }
    const confirm:Component<{initial:boolean}>=async (attrs,children,session)=>{
       return Element.stringify(await session.prompt.confirm(children.join(''),attrs.initial))
    }
    export function install(ctx: Context) {
        // 基本元素
        ctx.component('face', Element.face)
            .component('reply', Element.reply)
            .component('mention', Element.mention)
            .component('mention_all', Element.mention_all)
            .component('audio', Element.audio)
            .component('video', Element.video)
            .component('voice', Element.voice)
            .component('image', Element.image)
            .component('file', Element.file)
            .component('location', Element.location)
            .component('xml', Element.xml)
            .component('json', Element.json)
            .component('confirm',confirm)
        // 内置组件
        ctx.component('template', (attrs, children) => children.join(''))
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
