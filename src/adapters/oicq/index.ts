import {Adapter, AdapterOptions} from "@/adapter";
import {Config as OicqConfig,Client} from "oicq";
import {Bot, BotOptions} from '@/bot'
import {App} from "@/app";
import {EventMap} from "oicq/lib/events";
import {Session} from "@/Session";
export interface OicqBotOptions extends OicqConfig{
    uin:number
    password?:string
}
export interface OicqEventMap extends App.BaseEventMap,EventMap{
}
export class OicqBot extends Client implements Bot<'oicq',OicqBotOptions,{},number>{
    public self_id:number
    public startTime:number
    constructor(public app:App, public adapter:Adapter<'oicq',BotOptions<OicqBotOptions>>, public options:BotOptions<OicqBotOptions>) {
        if(!options.data_dir) options.data_dir=app.options.data_dir
        super(options.uin,options)
        this.self_id=options.uin
    }
    emit<E extends keyof EventMap>(eventName: E, ...args:Parameters<EventMap[E]>): boolean {
        this.adapter.dispatch(eventName,this.createSession(eventName,...args))
        return super.emit(eventName,...args)
    }

    start(){
        this.login(this.options.password)
    }
    sendMsg(target_id: number, target_type: string, message) {
    }
    createSession<E extends keyof OicqEventMap>(event:E,...args:Parameters<OicqEventMap[E]>):Session<'oicq', OicqEventMap, E>{
        const obj=typeof args[0]==="object"?args.shift():{}
        Object.assign(obj,{
            bot:this,
            platform:'oicq',
            adapter:this.adapter,
            event,
        },{args})
        return new Session<"oicq", OicqEventMap, E>(this.adapter,this.self_id,event,obj)
    }
}
export class OicqAdapter extends Adapter<'oicq',BotOptions<OicqBotOptions>,{},OicqEventMap>{
    constructor(app:App, platform, options:AdapterOptions<OicqBotOptions>) {
        super(app,platform,options);
    }
    async start(){
        for(const botOptions of this.options.bots){
            this.startBot(botOptions)
        }
    }
}
Adapter.define('oicq',OicqAdapter)
Bot.define('oicq',OicqBot)