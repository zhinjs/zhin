import type { SendOptions } from "./types.js";
import { Message } from "./message.js";
import { Adapter, Adapters } from "./adapter.js";
/**
 * Bot接口：所有平台机器人需实现的统一接口。
 * 负责消息格式化、连接、断开、消息发送等。
 * @template M 消息类型
 * @template T 配置类型
 */
export interface Bot<Config extends object= {},Event extends object = {}> {
  $id:string
  /** 机器人配置 */
  $config: Config;
  /** 是否已连接 */
  $connected?: boolean;
  /** 格式化平台消息为标准Message结构 */
  $formatMessage(event: Event): Message<Event>;
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
  export type Config =Adapter.BotConfig<Adapters[keyof Adapters]>
}