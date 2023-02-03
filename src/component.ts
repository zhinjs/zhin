import {Awaitable} from "./types";
import {Session} from "./session";
import {Fragment, mention, face, image, Render} from "./element";
import {Context} from "@/context";
import {Segment} from "@/bot";
import {Random, Time} from "@/utils";

export type Component = Render<Awaitable<Fragment>, Session>
export namespace Component {
    export interface Options {
        session?: boolean
        passive?: boolean
    }

    export function install(ctx: Context) {
        ctx.component('at', (attrs) => mention(attrs.qq))
            .component('template', (attrs, children) => children.join(''))
            .component('face', (attrs) => face(attrs.id))
            .component('image', (attrs) => image(attrs.src))
            .component('execute', async (attrs, children, session) => {
                return Segment.stringify(await session.execute(Segment.parse(children.join(''))))
            }, {session: true})
            .component('prompt', async (attrs, children, session) => {
                return await session.prompt[attrs.type ||= 'text'](children.join(''), attrs)
            }, {session: true})
            .component('random', async (attrs, children, session) => {
                return Random.pick(children).toString()
            })
            .component('time', (attrs) => {
                let ms = attrs.value?+attrs.value:Date.now()
                return Time.template(attrs.format||'yyyy-MM-dd hh:mm:ss',new Date(ms))
            }, {session: true})
    }
}
