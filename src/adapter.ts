import {Bot, BotConstruct, BotList, BotOptions} from "./bot";
import {Zhin} from "./zhin";
import {Session} from "./Session";
import {Logger} from "log4js";
import {EventEmitter} from "events";
import {Dispose} from "./dispose";
import Element from "@/element";

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
    public bots:BotList
    logger:Logger
    private _status:Record<string,Adapter.BotStatus>={}
    protected constructor(public app:Zhin, public protocol:K, public options:AdapterOptions<BO,AO>) {
        super()
        this.bots=new BotList()
        this.logger=app.getLogger(protocol)
        this.app.on('start',()=>this.start())
        this.on('message.receive',(bot_id:string|number,message)=>{
            this.botStatus(bot_id).recv_msg_cnt++
            const session=this.bots.get(bot_id).createSession('message',message)
            session.render().then(elements=>{
                session.elements=elements
            }).finally(()=>{
                this.app.dispatch(`${this.protocol}.message`,session)
            })
        })
        this.on('bot.online',(bot_id)=>{
            this.botStatus(bot_id).online=true
            this.app.emit(`bot.online`,this.protocol,bot_id)
        })
        this.on('bot.offline',(bot_id)=>{
            this.botStatus(bot_id).online=false
            this.app.emit(`bot.offline`,this.protocol,bot_id)
        })
        this.on('message.send',(bot_id:string|number,message:Bot.MessageRet)=>{
            let cache=this._cache.get(String(bot_id))
            if(!cache) this._cache.set(String(bot_id),cache=new Map<number, Set<string>>())
            let time=Number.parseInt((Date.now()/1000)+'')
            let set=cache.get(time)
            if(!set) cache.set(time,set=new Set())
            set.add(message.message_id)
            this.botStatus(bot_id).sent_msg_cnt++
        })
    }
    protected readonly _cache = new Map<string, Map<number,Set<string>>>()
    protected _calcMsgCntPerMin(bot_id:string) {
        let cnt = 0
        let cache=this._cache.get(bot_id)
        if(!cache) this._cache.set(bot_id,cache=new Map<number, Set<string>>())
        for (let [time, set] of cache) {
            if (Date.now()/1000 - time >= 60)
                cache.delete(time)
            else
                cnt += set.size
        }
        return cnt
    }
    get status(){
        Object.keys(this._status).forEach(bot_id=>{
            this._status[bot_id].msg_cnt_per_min=this._calcMsgCntPerMin(bot_id)
        })
        return this._status
    }
    botStatus(uin:string|number){
        return this.status[uin]
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
    protected async start(...args:any[]){
        for (const botOptions of this.options.bots) {
            this.startBot(botOptions)
        }
    }
    async stop(...args:any[]){}
    protected startBot(options:BotOptions<BO>){
        const Construct=Bot.botConstructors[this.protocol]
        if(!Construct) throw new Error(`can not find bot constructor from protocol:${this.protocol}`)
        const bot=new Construct(this.app,this,options)
        this.status[bot.self_id]={
            lost_times: 0,
            msg_cnt_per_min: 0,
            recv_msg_cnt: 0,
            sent_msg_cnt: 0,
            start_time: 0,
            online:false
        }
        bot.start()
        this.botStatus(bot.self_id).start_time=Date.now()
        this.bots.push(bot)
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
    export interface BotStatus{
        start_time:number
        lost_times:number
        recv_msg_cnt:number
        sent_msg_cnt:number
        msg_cnt_per_min:number
        online:boolean
    }
    export function get<K extends keyof Zhin.Adapters>(protocol:K){
        return {
            Adapter:adapterConstructs[protocol],
            Bot:Bot.botConstructors[protocol]
        }
    }
}