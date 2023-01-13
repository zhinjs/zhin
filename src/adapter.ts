import {Bot, BotConstruct, BotList, BotOptions} from "@/bot";
import {App} from "@/app";
import {OicqAdapter} from "@/adapters/oicq";
import {Session} from "@/Session";
import {Logger} from "log4js";
import {OneBotAdapter} from "@/adapters/onebot";

interface AdapterConstruct<K extends keyof Adapters=keyof Adapters,BO extends BotOptions = BotOptions, AO = {}> {
    new(app: App, protocol:K, options: AdapterOptions<BO, AO>): Adapter<K,BO, AO>
}

export type AdapterOptions<BO ={}, AO = {}> = {
    bots?: BotOptions<BO>[]
} & AO
export type AdapterOptionsType<A extends Adapter>=A extends Adapter<infer K,infer BO,infer AO>?AdapterOptions<BO, AO>:unknown

export abstract class Adapter<
    K extends keyof Adapters=keyof Adapters,
    BO = {},
    AO = {},
    EM extends App.BaseEventMap=App.BaseEventMap
    > {
    public bots:BotList<string|number>
    logger:Logger
    protected constructor(public app:App, public protocol:K, public options:AdapterOptions<BO,AO>) {
        this.bots=new BotList<string | number>()
        this.logger=app.getLogger(protocol)
        this.app.on('start',()=>this.start())
    }
    getLogger(sub_type:string){
        return this.app.getLogger(this.protocol,sub_type)
    }
    async start(...args:any[]){
    }
    async stop(...args:any[]){}
    protected startBot(options:BotOptions<BO>){
        const Construct=Bot.botConstructors[this.protocol]
        if(!Construct) throw new Error(`can not find bot constructor from protocol:${this.protocol}`)
        const bot=new Construct(this.app,this,options)
        bot.start()
        bot.startTime = new Date().getTime()
        this.bots.push(bot)
    }
    dispatch<E extends keyof EM>(event:E,session:Session<K, EM, E>){
        if(typeof event==='symbol') return this.app.broadcast(event,session)
        this.app.broadcast(`${this.protocol}.${event as string}`,session)
    }
}
export interface Adapters{
    oicq:OicqAdapter
    onebot:OneBotAdapter
}
export type AdapterConstructs={
    [P in keyof Adapters]:AdapterConstruct
}
export namespace Adapter {
    export const adapterConstructs:Partial<AdapterConstructs>={}
    export function define<K extends keyof Adapters, BO={}, AO={}>(key: K, protocolConstruct: AdapterConstruct<K,BO, AO>,botConstruct:BotConstruct<K,BO,AO>) {
        adapterConstructs[key]=protocolConstruct
        Bot.define(key,botConstruct)
    }
    export function get<K extends keyof Adapters>(protocol:K){
        return {
            Adapter:adapterConstructs[protocol],
            Bot:Bot.botConstructors[protocol]
        }
    }
}