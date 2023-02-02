import {Awaitable} from "./types";
import {Session} from "./session";
import {Fragment, mention,face,image, Render} from "./element";
import {Context} from "@/context";
import {Segment} from "@/bot";
import {Random, Time} from "@/utils";

export type Component= Render<Awaitable<Fragment>, Session>
export namespace Component {
    export interface Options {
        session?: boolean
        passive?: boolean
    }
    export function install(ctx:Context){
        ctx.component('at',(attrs)=>mention(attrs.qq))
            .component('template',(attrs,children)=>children.join(''))
            .component('face',(attrs)=>face(attrs.id))
            .component('image',(attrs)=>image(attrs.src))
            .component('execute', async (attrs, children, session) => {
                return Segment.stringify(await session.execute(Segment.parse(children.join(''))))
            }, { session: true })
            .component('prompt', async (attrs, children, session) => {
                return await session.prompt[attrs.type||='text'](children.join(''),attrs)
            }, { session: true })
            .component('random', async (attrs, children, session) => {
                return Random.pick(children).toString()
            })
            .component('time', (attrs,children,session) => {
            let ms = +attrs.value

            const units = ['day', 'hour', 'minute', 'second'] as const
            const unitsCN = ['天', '时', '分', '秒'] as const
            for (let index = 0; index < 3; index++) {
                const major = Time[units[index]]
                const minor = Time[units[index + 1]]
                if (ms >= major - minor / 2) {
                    ms += minor / 2
                    let result = Math.floor(ms / major) + ' ' + unitsCN[index]
                    if (ms % major > minor) {
                        result += ` ${Math.floor(ms % major / minor)} ` +  unitsCN[index+1]
                    }
                    return result
                }
            }
            return Math.round(ms / Time.second) + ' ' + '秒'
        }, { session: true })
    }
}
