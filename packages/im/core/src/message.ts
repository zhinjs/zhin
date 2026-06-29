import {MessageElement, MessageSender, SendContent} from "./types";
import { Component } from "./component.js";
import { Adapters } from "./adapter.js";
import {
  alignReplySegments as alignReplySegmentsImpl,
  quoteIdFromContent as quoteIdFromContentImpl,
  syncQuoteId as syncQuoteIdImpl,
} from "./message-quote.js";
import { isActionMessage as isActionMessageImpl } from "./built/interactive-segments/action.js";
/**
 * 消息组件类型：用于自定义消息结构
 */
export type MessageComponent<T extends object>={
    type:Component<T&{children?:SendContent|Promise<SendContent>}>
    data:T
}
/**
 * 消息频道信息
 */
export interface MessageChannel{
    id: string;
    type: MessageType;
    /**
     * 私聊/子频道消息的来源场景（如 QQ 群临时会话：type=private + parent.group）。
     * 出站时 adapter 据此选择 API（icqq → send_temp_msg）。
     */
    parent?: {
        type: 'group' | 'channel';
        id: string;
    };
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
    $adapter:keyof Adapters
    $endpoint:string
    $content: MessageElement[];
    $sender: MessageSender;
    $reply?(content:SendContent,quote?:boolean|string):Promise<string>
    $recall?():Promise<void>
    $channel: MessageChannel;
    $timestamp: number;
    $raw: string;
    /** 本条消息引用的上游 message_id（平台原样字符串） */
    $quote_id?: string;
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

    export function quoteIdFromContent(content: MessageElement[]): string | undefined {
        return quoteIdFromContentImpl(content);
    }

    export function syncQuoteId(message: Message<any>): void {
        syncQuoteIdImpl(message);
    }

    export function alignReplySegments(content: MessageElement[], quoteId?: string): void {
        alignReplySegmentsImpl(content, quoteId);
    }

    export function actionPayload(message: Message<any>): string | undefined {
        for (const item of message.$content ?? []) {
            if (typeof item === 'string') continue;
            if (item.type === 'action' && item.data?.payload) {
                return String(item.data.payload);
            }
        }
        return undefined;
    }

    export function isAction(message: Message<any>): boolean {
        return isActionMessageImpl(message);
    }
}