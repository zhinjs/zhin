import type {RegisteredAdapters, SendOptions,AdapterConfig} from "./types.js";
import {Message} from "./message.js";
/**
 * Bot接口：所有平台机器人需实现的统一接口。
 * 负责消息格式化、连接、断开、消息发送等。
 * @template M 消息类型
 * @template T 配置类型
 */
export interface Bot<M extends object={},T extends BotConfig=BotConfig> {
    /** 机器人配置 */
    $config: T;
    /** 是否已连接 */
    $connected?: boolean;
    /** 格式化平台消息为标准Message结构 */
    $formatMessage(message:M):Message<M>
    /** 连接机器人 */
    $connect():Promise<void>
    /** 断开机器人 */
    $disconnect():Promise<void>
    /** 发送消息 */
    $sendMessage(options: SendOptions): Promise<void>
}
/**
 * Bot配置类型，所有平台机器人通用
 */
export interface BotConfig{
    context:string
    name:string
    [key:string]:any
}