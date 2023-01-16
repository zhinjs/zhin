import {Awaitable} from "@/types";
import {Session} from "@/session";
import {Fragment, Render} from "@/element";

export type Component= Render<Awaitable<Fragment>, Session>
export namespace Component {
    export interface Options {
        session?: boolean
        passive?: boolean
    }
}
