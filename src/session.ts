import {Adapters} from "@/adapter";
import {Bots, Sendable} from "@/bot";
import {App} from "@/app";
export type FunctionToSessionObj<E extends (...args:any[])=>any>=E extends (...args:infer R)=>any?ParametersToObj<R>:unknown
export type ParametersToObj<A extends any[]>=A extends [infer R,...infer L]? R extends object?R & {args:L}: { args:[R,...L] }:unknown
export interface Session<P extends keyof Adapters=keyof Adapters, EM extends App.BaseEventMap=App.BaseEventMap, E extends keyof EM=keyof EM>{
    platform:P,
    app:App
    adapter:Adapters[P],
    bot:Bots[P]
    event:E
}
export type ToSession<P extends keyof Adapters=keyof Adapters,EM extends App.BaseEventMap=App.BaseEventMap,E extends keyof EM=keyof EM>=Session<P,EM,E> & FunctionToSessionObj<EM[E]>
export class Session<P extends keyof Adapters=keyof Adapters,EM extends App.BaseEventMap=App.BaseEventMap,E extends keyof EM=keyof EM>{
    constructor(public adapter:Adapters[P],self_id,public event:E,obj:FunctionToSessionObj<EM[E]>) {
        this.platform=adapter.platform as any
        this.app=adapter.app
        this.bot=adapter.bots.get(self_id) as any
        Object.assign(this,obj)
    }
    approve(accept?:boolean,reason?:string){

    }
    reply(message:Sendable,quote?:boolean){

    }
}
