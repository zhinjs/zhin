import {Adapter, AdapterOptions} from "@/adapter";
import {
    Config as IcqqConfig,
    Quotable,
    Client,
    Sendable,
    MessageElem,
    MessageRet, genGroupMessageId, genDmMessageId
} from "icqq";
import {Bot, BotOptions} from '@/bot'
import {Element} from '@/element'
import {Zhin} from "@/zhin";
import {NSession, Session} from "@/session";
import {EventMap} from "icqq/lib/events";

async function sendMsg(this:Client,target_id:number,target_type:string,content:Element[]){
    const replyElement=content.find(ele=>ele.type==='reply')
    const ele=[...content]
    let quote:Quotable
    if(replyElement){
        quote=await this.getMsg(replyElement.attrs.message_id)
        ele.splice(content.indexOf(replyElement),1)
    }
    const args:any[]=[]
    const message=fromElement(ele)
    let func:string
    switch (target_type){
        case 'private':
            func='sendPrivateMsg'
            args.push(target_id)
            break;
        case 'discuss':
            func='sendDiscussMsg'
            args.push(target_id)
            break;
        case 'group':
            func='sendGroupMsg'
            args.push(target_id)
            break
        case 'guild':
            func='sendGuildMsg'
            args.push(...String(target_id).split(':'))
            break
        default:
            throw new Error('not support')
    }
    const messageRet=(await this[func](...[...args,message,quote])) as MessageRet
    return {
        message_id:messageRet.message_id,
        from_id:this.uin,
        to_id:target_id,
        type:target_type as Bot.MessageType,
        elements:content
    } as Bot.MessageRet
}
export class IcqqBot extends Bot<'icqq', IcqqBotOptions, {}, Client> {
    constructor(app: Zhin,adapter: IcqqAdapter,options: BotOptions<IcqqBotOptions>) {
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
        this.callApi=async <K extends keyof Bot.Methods>(apiName:K, ...args:Parameters<Bot.Methods[K]>)=> {
            switch (apiName){
                case "deleteMsg":
                    return await this.internal.deleteMsg(args[0] as string) as ReturnType<Bot.Methods[K]>
                case "sendMsg":
                    return await sendMsg.apply(this.internal,args as any)as ReturnType<Bot.Methods[K]>
                case 'getMsg':
                    const res=await this.internal.getMsg(args[0] as string)
                    return {...res,elements:toElement(res.message)} as ReturnType<Bot.Methods[K]>
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
    isGroupAdmin(session): boolean {
        return session.message_type==='group' && session.member.is_admin
    }
    isGroupOwner(session): boolean {
        return session.message_type==='group' && session.member.is_owner
    }

    createSession<E extends keyof EventMap>(event: E, ...args: Parameters<EventMap[E]>): NSession<'icqq',E> {
        let obj:Record<string, any> = typeof args[0] === "object" ? args.shift() : {}
        if(!obj) obj={}
        Object.assign(obj, {
            bot: this,
            protocol: 'icqq',
            adapter: this.adapter,
            event,
            user_name:obj.nickname||obj.sender?.nickname||obj.sender?.card||obj.sender?.title,
            type: obj.post_type||event,
            detail_type: obj.message_type || obj.request_type || obj.system_type || obj.notice_type||'guild',
        }, {args})
        delete obj.repl
        let msg=[...(obj.message||'')]
        if(obj.source){
            obj.quote={
                message_id:obj.detail_type==='group'?
                    genGroupMessageId(obj.group_id,obj.source.user_id,obj.source.seq,obj.source.rand,obj.source.time):
                    genDmMessageId(obj.user_id,obj.source.seq,obj.source.rand,obj.source.time),
                user_id:obj.source.user_id,
                element:[Element('text',{text:obj.source.message})]
            }
            // oicq bug:引用消息会在message里产生一个AtElem
            msg.shift()
            if(msg[0]?.type==='text'){
                msg[0].text=msg[0].text.trim()
            }
            obj.message=typeof obj.message==='string'?msg.join(''):Array.isArray(obj.message)?msg:undefined
            delete obj.source
        }
        const session=new Session<"icqq">(this.adapter, this.self_id, event, obj)
        session.elements=toElement(obj.message,session)
        return session as any
    }

}

export class IcqqAdapter extends Adapter<'icqq', IcqqBotOptions, {}> {
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
export type IcqqEventMap = {
    [P in keyof EventMap]:(...args:Parameters<EventMap[P]>)=>void
}
Adapter.define('icqq', IcqqAdapter, IcqqBot)