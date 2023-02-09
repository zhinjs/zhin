import {Adapter, AdapterOptions} from "@/adapter";
import {
    Config as IcqqConfig,
    Quotable,
    Client,
    Sendable,
    MessageElem,
    MessageRet, GroupMessageEvent, DiscussMessageEvent
} from "icqq";
import {Bot, BotOptions} from '@/bot'
import Element from '@/element'
import {Zhin} from "@/zhin";
import {PayloadWithSession, Session} from "@/session";
import {MergeEventMap, PrivateMessageEvent} from "icqq/lib/events";


export class IcqqBot extends Bot<'icqq', IcqqBotOptions, {}, Client> {
    constructor(app: Zhin,adapter: Adapter<'icqq', BotOptions<IcqqBotOptions>>,options: BotOptions<IcqqBotOptions>) {
        if (!options.data_dir) options.data_dir = app.options.data_dir
        super(app,adapter,options)
        this.internal = new Client(options)
        this.self_id = options.self_id
        const _this=this
        const trip=this.internal.trip
        this.internal.trip=function (this:Client,event,...args){
            _this.adapter.dispatch(event,_this.createSession(event,...args))
            return trip.apply(this,[event,...args])
        }
        this.internal.on('system.online',()=>{
            this.adapter.emit('bot.online',this.self_id)
        })
        this.internal.on('system.offline',()=>{
            this.adapter.emit('bot.offline',this.self_id)
        })
        this.callApi=<K extends keyof Client>(apiName, ...args)=> {
            let fn=this.internal[apiName]
            if(typeof fn==='function') return fn.apply(this.internal,args)
            if(fn===undefined) fn=this[apiName]
            if(typeof fn==='function') return fn.apply(this,args)
            return fn
        }
        this.internal.sendMsg=async function (this:Client,target_id, target_type, content):Promise<Bot.MessageRet>{
            const replyElement=content.find(ele=>ele.type==='reply')
            const ele=[...content]
            let quote:Quotable
            if(replyElement){
                quote=await this.getMsg(replyElement.attrs.message_id)
                ele.splice(content.indexOf(replyElement),1)
            }
            const message=fromElement(ele)
            let func:string
            switch (target_type){
                case 'private':
                    func='sendPrivateMsg'
                    break;
                case 'discuss':
                    func='sendDiscussMsg'
                    break;
                case 'group':
                    func='sendGroupMsg'
                    break
                default:
                    throw new Error('not support')
            }
            const messageRet=(await this[func](target_id,message,quote)) as MessageRet
            return {
                message_id:messageRet.message_id,
                from_id:this.uin,
                to_id:target_id,
                type:target_type as Bot.MessageType,
                elements:content
            }
        }
    }

    start() {
        this.internal.login(Number(this.options.self_id), this.options.password)
    }
    stop(){
        this.internal.offTrap()
        this.internal.logout()
    }
    isChannelAdmin(session){
        return false
    }
    isGroupAdmin(session: PayloadWithSession<'icqq','message'>): boolean {
        return session.message_type==='group' && session.member.is_admin
    }
    isGroupOwner(session: PayloadWithSession<'icqq','message'>): boolean {
        return session.message_type==='group' && session.member.is_owner
    }

    createSession<E extends keyof IcqqEventMap>(event: E, ...args: Parameters<IcqqEventMap[E]>): Session<'icqq', E> {
        const obj = typeof args[0] === "object" ? args.shift() : {}
        Object.assign(obj, {
            bot: this,
            protocol: 'icqq',
            adapter: this.adapter,
            event,
            type: obj.post_type,
            detail_type: obj.message_type || obj.request_type || obj.system_type || obj.notice_type,
        }, {args})
        delete obj.reply
        const session=new Session<"icqq", E>(this.adapter, this.self_id, event, obj)
        session.elements=toElement(obj.message,session)
        return session
    }

}

export class IcqqAdapter extends Adapter<'icqq', IcqqBotOptions, {}, IcqqEventMap> {
    constructor(app: Zhin, protocol, options: AdapterOptions<IcqqBotOptions>) {
        super(app, protocol, options);
    }

}

function toElement<S>(msgList: Sendable,ctx?:S) {
    if(!msgList) return []
    msgList = [].concat(msgList)
    let result:Element[]=[]
    msgList.forEach((msg) => {
        if (typeof msg === 'string') msg={type:'text',text:msg}
        if(msg.type==="text"){
            result.push(...Element.parse(msg.text,ctx))
        }else{let {type, ...attrs} = msg;
            result.push(Element(type === 'at' ? attrs['qq'] ? 'mention' : "mention_all" : type,{
                user_id: attrs['qq'],
                file:attrs['file_id']||attrs['src'],
                content:attrs['text'],
                ...attrs
            }))
        }
    })
    return result
}

declare module 'icqq' {
    interface Client {
        sendMsg(target_id: number, target_type: string, content: Element[]):Promise<Bot.MessageRet>
    }
}
const allowElement=['text','at','image','face','rps','dice']
function fromElement(elementList: Element | string | number | (Element | string | number)[]) {
    elementList = [].concat(elementList);
    return elementList.map((element) => {
        if (typeof element !== 'object') element = String(element)
        if (typeof element === 'string') {
            return {type: 'text', text: element}
        }
        const {type, attrs, children} = element;
        const result = {
            type: type.replace('mention', 'at').replace('at_all', 'at'),
            ...attrs,
            text:attrs.text||children.join('')
        }
        if(allowElement.includes(result.type)){
            if (attrs['user_id']) result['qq'] = attrs['user_id']
            if (attrs['file_id']) result['file'] = attrs['file_id']
            if (attrs['src']) result['file'] = attrs['src']
            return result
        }
        return element.toString()
    }) as MessageElem[]
}

export interface IcqqBotOptions extends IcqqConfig {
    self_id: string
    password?: string
}
export interface EventMap<T=any>{
    system(...args:any[]):T
    message(event:PrivateMessageEvent|GroupMessageEvent|DiscussMessageEvent):T
    notice(event:Parameters<MergeEventMap['notice.friend']> | Parameters<MergeEventMap['notice.group']>):T
    request(event:Parameters<MergeEventMap['request.friend']> | Parameters<MergeEventMap['request.group']>):T
}
export interface IcqqEventMap extends Zhin.BaseEventMap,EventMap<IcqqBot> {

}
Adapter.define('icqq', IcqqAdapter, IcqqBot)