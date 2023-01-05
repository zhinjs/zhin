import {Bot, BotList, BotOptions} from "@/bot";
import {App} from "@/app";
import {OicqAdapter} from "@/adapters/oicq";
import {Session} from "@/Session";

interface AdapterConstruct<K extends keyof Adapters=keyof Adapters,BO extends BotOptions = BotOptions, AO = {}> {
    new(app: App, platform:K, options: AdapterOptions<BO, AO>): Adapter<K,BO, AO>
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
    protected constructor(public app:App, public platform:K, public options:AdapterOptions<BO,AO>) {
        this.bots=new BotList<string | number>()
        this.app.on('start',()=>this.start())
    }
    async start(...args:any[]){}
    async stop(...args:any[]){}
    protected startBot(options:BotOptions<BO>){
        const Construct=Bot.botConstructors[this.platform]
        if(!Construct) throw new Error(`can not find bot constructor from platform:${this.platform}`)
        const bot=new Construct(this.app,this,options)
        bot.start()
        bot.startTime = new Date().getTime()
        this.bots.push(bot)
    }
    dispatch<E extends keyof EM>(event:E,session:Session<K, EM, E>){
        if(typeof event==='symbol') return this.app.emit(event,session)
        this.app.emit(`${this.platform}.${event as string}`,session)
    }
}
export interface Adapters{
    oicq:OicqAdapter
}
export type AdapterConstructs={
    [P in keyof Adapters]:AdapterConstruct
}
export namespace Adapter {
    export const adapterConstructs:Partial<AdapterConstructs>={}
    export function define<K extends keyof Adapters, BO extends BotOptions, AO={}>(key: K, adapterConstruct: AdapterConstruct<K,BO, AO>) {
        adapterConstructs[key]=adapterConstruct
    }
    export function get<K extends keyof Adapters>(platform:K){
        return {
            Adapter:adapterConstructs[platform],
            Bot:Bot.botConstructors[platform]
        }
    }
}