import type {MessageElement, SendContent} from "./types.js";
import { Component } from "./component.js";
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
     * 私聊/子频道消息的来源场景：
     * - 群临时会话：type=private + parent.group
     * - QQ 子频道：type=channel + parent.guild
     */
    parent?: {
        type: 'group' | 'channel' | 'guild';
        id: string;
    };
}
/**
 * 消息类型枚举
 */
export type MessageType = 'group' | 'private' | 'channel'
