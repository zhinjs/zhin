import type { SendOptions } from "./types.js";
import { Message } from "./message.js";
/**
 * Bot接口：所有平台机器人需实现的统一接口。
 * 负责消息格式化、连接、断开、消息发送等。
 * @template M 消息类型
 * @template T 配置类型
 */
export interface Bot<M extends object = {}, T extends Bot.Config = Bot.Config> {
  /** 机器人配置 */
  $config: T;
  /** 是否已连接 */
  $connected?: boolean;
  /** 格式化平台消息为标准Message结构 */
  $formatMessage(message: M): Message<M>;
  /** 连接机器人 */
  $connect(): Promise<void>;
  /** 断开机器人 */
  $disconnect(): Promise<void>;
  /** 撤回消息 */
  $recallMessage(id: string): Promise<void>;
  /** 发送消息返回消息id */
  $sendMessage(options: SendOptions): Promise<string>;
}
export namespace Bot {
  /**
   * Bot配置类型，所有平台机器人通用
   */
  export interface Config {
    context: string;
    name: string;
    [key: string]: any;
  }
}
