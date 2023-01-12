import {Adapter, App, Bot, BotOptions, SegmentElem, Sendable, Session} from "@";
import {OneBotAdapter} from "@/adapters/onebot";
import {OneBotPayload, Types} from './types'
import {EventEmitter} from "events";
import {createHttpHandler, createWebhookHandler, createWsHandler, createWsReverseHandler} from "@/adapters/onebot/link";
import {Logger} from "log4js";
export interface OneBot{
    sendPayload(payload:OneBotPayload):void
    stop():void
}
export class OneBot extends EventEmitter implements Bot<
    `onebot`,
    OneBot.Options<keyof OneBotAdapter.AdapterOptions>,
    OneBotAdapter.Options,
    string>{
    self_id: string;
    startTime: number;
    stat:Record<string, any>={}
    logger:Logger
    constructor(public app:App, public adapter:Adapter<'onebot',OneBot.Options<keyof OneBotAdapter.AdapterOptions>,OneBotAdapter.Options>, public options:BotOptions<OneBot.Options<keyof OneBotAdapter.AdapterOptions>>) {
        super();
        if((['http','ws']).includes(options.type)) this.self_id=options['self_id']
        this.logger=this.adapter.getLogger(options.type)
    }
    isOnline(){
        return true
    }
    createSession(event,payload){
        return new Session<'onebot'>(this.adapter,this.self_id,event,{
            ...payload,
            segments:payload.message
        })
    }
    private async runAction<T extends keyof Types.ActionMap>(action:T,params?:Parameters<Types.ActionMap[T]>[0]):Promise<ReturnType<Types.ActionMap[T]>>{
        return new Promise(resolve => {
            this.sendPayload({
                action,
                params
            })
        })
    }
    isAdmin(session: Session): boolean {
        return false;
    }

    isMaster(session: Session): boolean {
        return false;
    }

    reply(session: Session<'onebot'>, message: Sendable, quote?: boolean){
        switch (session.detail_type){
            case 'private':
                return this.sendMsg(String(session.user_id),'user',message)
            case 'group':
                return this.sendMsg(String(session.group_id),'group',message)
            case 'discuss':
                return this.sendMsg(String(session.discuss_id),'discuss',message)
            case 'channel':
                return this.sendMsg(String(session.guild_id),String(session.channel_id),message)
        }
    }
    deleteMsg(message_id:string){
        return this.runAction('delete_message',{message_id})
    }
    getFriendList(){
        return this.runAction('get_friend_list')
    }
    getFriendInfo(friend_id:string){
        return this.runAction('get_friend_info',{user_id:friend_id})
    }
    getGroupList(){
        return this.runAction('get_group_list')
    }
    getGroupInfo(group_id:string){
        return this.runAction('get_group_info',{group_id})
    }
    getGroupMemberList(group_id:string){
        return this.runAction('get_group_member_list',{group_id})
    }
    getGroupMemberInfo(group_id:string,member_id){
        return this.runAction('get_group_member_info',{group_id,member_id})
    }
    sendMsg(target_id: string, target_type: string, message: Sendable){
        const types= ['user','group','discuss']
        if(typeof message!=='object'){
            message={
                type:'text',
                data:{text:String(message)}
            }
        }
        if(!Array.isArray(message))message=[message]
        return this.runAction('send_message',{
            guild_id:types.includes(target_type)?undefined:target_id,
            channel_id:types.includes(target_type)?undefined:target_type,
            [target_type+'_id']:types.includes(target_type)?target_id:undefined,
            message:message as SegmentElem[]
        })
    }

    start(): any {
        switch (this.options.type){
            case "http":{
                return this.stop=createHttpHandler(this,this.options as OneBot.Options<'http'>)
            }
            case "webhook":{
                return this.stop=createWebhookHandler(this,this.options as OneBot.Options<'webhook'>)
            }
            case "ws":{
                return this.stop=createWsHandler(this,this.options as OneBot.Options<'ws'>)
            }
            case "ws_reverse":{
                return this.stop=createWsReverseHandler(this,this.options as OneBot.Options<'ws_reverse'>)
            }
        }
    }

}
export namespace OneBot{

    export type Options<T extends keyof OneBotAdapter.AdapterOptions>= {
        type:T
    } & OneBotAdapter.AdapterOptions[T]
}
