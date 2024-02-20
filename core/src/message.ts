import { Bot, Dict } from '@/types';
import { Prompt } from '@/prompt';
import { Adapter, AdapterBot, AdapterReceive } from '@/adapter';
export interface MessageBase{
    from_id:string
    group_id?:string|number
    guild_id?:string|number
    channel_id?:string|number
    discuss_id?:string|number
    sender:MessageSender
    raw_message:string
    quote?:{
        message_id:string
        message?:string
    }
    message_type:Message.Type
}
export interface Message<AD extends Adapter=Adapter> extends MessageBase{
    prompt:Prompt<any>
    reply(message:string):Promise<any>
}
export class Message<AD extends Adapter> {
    constructor(public adapter:AD,public bot:Bot<AD>,public original?:AdapterReceive<AD>) {
    }
    async reply(message:string,quote:boolean=true){
        return this.adapter.sendMsg(this.bot.unique_id,this.from_id,this.message_type,message,quote?this:undefined)
    }
    toJSON():MessageBase{
        return {
            from_id:this.from_id,
            sender:this.sender,
            raw_message:this.raw_message,
            message_type:this.message_type,
        }
    }
}
const wrapKV=Object.entries({
    ',':'_🤤_🤖_',
    '&':'$amp;',
    '<':'&lt;',
    '>':'&gt;'
}).map(([key,value])=>({key,value}))
export function wrap(message:string){
    for(const {key,value} of wrapKV){
        message=message.replace(new RegExp(key,'g'),value)
    }
    return message
}
export function unwrap(message:string){
    for(const {key,value} of wrapKV){
        message=message.replace(new RegExp(value,'g'),key)
    }
    return message
}
export namespace Message{
    export type Render<T extends Message=Message>=(template:string,message?:T)=>Promise<string>|string
    export type Segment=`<${string},${string}>`|string
    export type DefineSegment={
        (type:string,data:Dict):string
        text(text:string):string
        face(id:number):string
        image(url:string):string
        at(user_id:string|number):string
    }
    export type Type = 'private'|'group'|'guild'|'direct';
    export function fromEvent<AD extends Adapter>(adapter:AD,bot:Bot<AD>,message:AdapterReceive<AD>){
        const result= new Message(adapter,bot,message)
        result.prompt=new Prompt(adapter,bot,result)
        return result
    }
    export function fromJSON<AD extends Adapter>(adapter:AD,bot:Bot<AD>,json:MessageBase){
        const result= new Message(adapter,bot)
        result.from_id=json.from_id
        result.sender=json.sender
        result.message_type=json.message_type
        result.raw_message=json.raw_message
        result.prompt=new Prompt(adapter,bot,result)
        return result
    }
}
export const segment:Message.DefineSegment=function(type, data){
    return `<${type},${Object.entries(data).map(([key,value])=>{
        return `${key}=${wrap(JSON.stringify(value))}`
    }).join()}>`
} as Message.DefineSegment
segment.text=(text)=>text
segment.face=(id:number)=>`<face,id=${id}>`
segment.image=(file:string)=>`<image,file=${file}>`
segment.at=(user_id)=>`<at,user_id=${user_id}>`
type MessageSender={
    user_id?:string|number
    user_name?:string
    permissions?:string[]
}
