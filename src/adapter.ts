import {Bot, BotConstruct, BotList, BotOptions} from "./bot";
import {Zhin} from "./zhin";
import {Session} from "./Session";
import {Logger} from "log4js";
import {EventEmitter} from "events";
import {Dispose} from "./dispose";

interface AdapterConstruct<K extends keyof Zhin.Adapters=keyof Zhin.Adapters,BO extends BotOptions = BotOptions, AO = {}> {
    new(app: Zhin, protocol:K, options: AdapterOptions<BO, AO>): Adapter<K,BO, AO>
}

export type AdapterOptions<BO ={}, AO = {}> = {
    bots?: BotOptions<BO>[]
} & AO
export type AdapterOptionsType<A extends Adapter>=A extends Adapter<infer K,infer BO,infer AO>?AdapterOptions<BO, AO>:unknown

export abstract class Adapter<
    K extends keyof Zhin.Adapters=keyof Zhin.Adapters,
    BO = {},
    AO = {},
    EM extends Zhin.BaseEventMap=Zhin.BaseEventMap
    >  extends EventEmitter{
    public bots:BotList<string|number>
    logger:Logger
    protected constructor(public app:Zhin, public protocol:K, public options:AdapterOptions<BO,AO>) {
        super()
        this.bots=new BotList<string | number>()
        this.logger=app.getLogger(protocol)
        this.app.on('start',()=>this.start())
    }
    getLogger(sub_type:string){
        return this.app.getLogger(this.protocol,sub_type)
    }
    on(event,listener){
        super.on(event,listener)
        return Dispose.from(this,()=>{
            super.off(event,listener)
        })
    }
    async start(...args:any[]){
    }
    async stop(...args:any[]){}
    protected startBot(options:BotOptions<BO>){
        const Construct=Bot.botConstructors[this.protocol]
        if(!Construct) throw new Error(`can not find bot constructor from protocol:${this.protocol}`)
        const bot=new Construct(this.app,this,options)
        bot.start()
        bot.stat.start_time = new Date().getTime()
        this.bots.push(bot)
    }
    dispatch<E extends keyof Zhin.BotEventMaps[K]>(event:E,session:Session<K, E>){
        this.emit(event as any,session)
        this.app.dispatch(`${this.protocol}.${String(event)}`,session)
    }
}
export type AdapterConstructs={
    [P in keyof Zhin.Adapters]:AdapterConstruct
}
export namespace Adapter {
    export const adapterConstructs:Partial<AdapterConstructs>={}
    export function define<K extends keyof Zhin.Adapters, BO={}, AO={}>(key: K, protocolConstruct: AdapterConstruct<K,BO, AO>,botConstruct:BotConstruct<K,BO,AO>) {
        adapterConstructs[key]=protocolConstruct
        Bot.define(key,botConstruct)
    }
    export function get<K extends keyof Zhin.Adapters>(protocol:K){
        return {
            Adapter:adapterConstructs[protocol],
            Bot:Bot.botConstructors[protocol]
        }
    }
}