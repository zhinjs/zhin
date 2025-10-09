import {MaybePromise} from "@zhin.js/types";
import {MessageSegment, MessageSender, RegisteredAdapter, SendContent} from "./types";

/**
 * 消息组件类型：用于自定义消息结构
 */
export type MessageComponent<T extends object>=(props:T&{children:SendContent})=>MaybePromise<SendContent>
/**
 * 消息频道信息
 */
export interface MessageChannel{
    id: string;
    type: MessageType;
}
/**
 * 消息类型枚举
 */
export type MessageType = 'group' | 'private' | 'channel'
/**
 * 消息基础结构
 */
export interface MessageBase {
    $id: string;
    $adapter:string
    $bot:string
    $content: MessageSegment[];
    $sender: MessageSender;
    $reply(content:SendContent,quote?:boolean|string):Promise<void>
    $channel: MessageChannel;
    $timestamp: number;
    $raw: string;
}
/**
 * 完整消息类型，支持扩展
 */
export type Message<T extends object={}>=MessageBase&T;
export namespace Message{
    /**
     * 工具方法：合并自定义字段与基础消息结构
     */
    export function from<T extends object>(input:T,format:MessageBase):Message<T>{
        return Object.assign(input,format)
    }
}