import {Adapters} from "@/adapter";
import {Bot, Bots, SegmentElem, Sendable} from "@/bot";
import {App} from "@/app";
import {Argv} from "@/argv";
import {Middleware} from "@/middleware";
import {Prompt} from "@/prompt";
export type FunctionToSessionObj<E extends (...args:any[])=>any>=E extends (...args:infer R)=>any?ParametersToObj<R>:unknown
export type ParametersToObj<A extends any[]>=A extends [infer R,...infer L]? R extends object?R & {args:L}: { args:[R,...L] }:unknown
export interface Session<P extends keyof Adapters=keyof Adapters, EM extends App.BaseEventMap=App.BaseEventMap, E extends keyof EM=keyof EM>{
    platform:P,
    post_type?:string
    detail_type?:string
    app:App
    prompt:Prompt
    segments:SegmentElem[]
    adapter:Adapters[P],
    bot:Bots[P]
    event:E
}
export type ToSession<P extends keyof Adapters=keyof Adapters,EM extends App.BaseEventMap=App.BaseEventMap,E extends keyof EM=keyof EM>=Session<P,EM,E> & FunctionToSessionObj<EM[E]>
export class Session<P extends keyof Adapters=keyof Adapters,EM extends App.BaseEventMap=App.BaseEventMap,E extends keyof EM=keyof EM>{
    constructor(public adapter:Adapters[P],self_id,public event:E,obj:FunctionToSessionObj<EM[E]>) {
        this.platform=adapter.platform as any
        this.app=adapter.app
        this.event=event
        this.bot=adapter.bots.get(self_id) as any
        Object.assign(this,obj)
        this.prompt=new Prompt(this.bot,this as any,this.app.options.delay.timeout||6000)
    }
    middleware(middleware:Middleware<Session>,timeout:number=this.app.options.delay.prompt){
        return new Promise<void|boolean|Sendable>(resolve => {
            const dispose=this.app.middleware(async (session,next)=>{
                if(Bot.getFullTargetId(this as any) !==Bot.getFullTargetId(session)) await next()
                dispose()
                clearTimeout(timer)
                resolve(await middleware(session,next))
            },true)
            const timer=setTimeout(()=>{
                dispose()
                resolve()
            },timeout)
        })
    }
    async execute(argv:SegmentElem[]|Argv=this.segments){
        if(Array.isArray(argv)) argv={
            session:this as any,
            bot:this.bot,
            ...Argv.parse(argv)
        }
        const command=this.app.findCommand(argv)
        if(!command) return
        const result=await command.execute(argv)
        if(!result || typeof result==='boolean') return
        if(Array.isArray(result) && !result.length) return
        await this.reply(result)

    }
    async reply(message:Sendable){
        return this.bot.reply(this,message,this.bot.options.quote_self)
    }
}
