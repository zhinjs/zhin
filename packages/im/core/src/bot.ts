import type { SendOptions } from "./types.js";
import { Message } from "./message.js";
import { Notice } from "./notice.js";
import { Request } from "./request.js";
import { Adapter, Adapters } from "./adapter.js";
/**
 * Bot接口：所有平台机器人需实现的统一接口。
 * 负责消息格式化、连接、断开、消息发送等。
 * @template Config 配置类型
 * @template Event 消息事件类型
 */
export interface Bot<Config extends object= {},Event extends object = {}> {
  $id:string
  /** 机器人配置 */
  $config: Config;
  /** 是否已连接 */
  $connected: boolean;
  /** 格式化平台消息为标准Message结构 */
  $formatMessage(event: Event): Message<Event>;
  /** 格式化平台通知为标准Notice结构（适配器可选实现） */
  $formatNotice?(event: any): Notice<any>;
  /** 格式化平台请求为标准Request结构（适配器可选实现） */
  $formatRequest?(event: any): Request<any>;
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
  export type Config<K extends keyof Adapters = keyof Adapters> =Adapter.BotConfig<Adapter.InferBot<Adapters[K]>> & {
    context: K;
  }
}