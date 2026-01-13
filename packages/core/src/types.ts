
import {MessageChannel,Message} from "./message.js";
import {Adapter} from "./adapter.js";
import {Bot} from "./bot.js";
import { SystemLog } from "./models/system-log.js";
import { User } from "./models/user.js";
import { Adapters } from "./adapter.js";
import { Databases,Registry } from "@zhin.js/database";
import { MessageComponent } from "./message.js";
import { ProcessAdapter } from "./built/adapter-process.js";

export type ArrayItem<T>=T extends Array<infer R>?R:unknown
export interface Models extends Record<string,object>{
  SystemLog: SystemLog
  User: User,
}
export type MaybePromise<T> = T extends Promise<infer U> ? T|U : T|Promise<T>;
export interface RegisteredAdapters {
  process: ProcessAdapter;
}
/**
 * 数据库配置类型，支持多种数据库驱动
 */
export type DatabaseConfig<T extends keyof Databases=keyof Databases>={
  dialect:T
} & Registry.Config[T]
/**
 * 获取对象所有value类型
 */
export type ObjectItem<T extends object>=T[keyof T]
/**
 * 已注册适配器名类型
 */
export type RegisteredAdapter=Extract<keyof Adapters, string>
/**
 * 指定适配器的消息类型
 */
export type AdapterMessage<T extends keyof RegisteredAdapters=keyof RegisteredAdapters>=RegisteredAdapters[T] extends Adapter<infer R>?BotMessage<R>:{}
/**
 * 指定适配器的配置类型
 */
export type AdapterConfig<T extends keyof RegisteredAdapters=keyof RegisteredAdapters>=RegisteredAdapters[T] extends Adapter<infer R>?PlatformConfig<R>:Bot.Config
/**
 * Bot实例的配置类型
 */
export type PlatformConfig<T>=T extends Bot<infer L,infer R>?R:Bot.Config
/**
 * Bot实例的消息类型
 */
export type BotMessage<T extends Bot>=T extends Bot<infer R>?R:{}
/**
 * 消息段结构，支持 text/image/at/face 等类型
 */
export interface MessageSegment {
  type: string;
  data: Record<string, any>;
}
export type MessageElement=MessageSegment|MessageComponent<any>
/**
 * 单个或数组类型
 */
export type MaybeArray<T>=T|T[]
/**
 * 消息发送内容类型
 */
export type SendContent=MaybeArray<string|MessageElement>
/**
 * 消息发送者信息
 */
export interface MessageSender{
  id: string;
  name?: string;
  permissions?:string[]
}
/**
 * 通用字典类型
 */
export type Dict<V=any,K extends string|symbol=string>=Record<K, V>;
/**
 * 用户信息结构
 */
export interface UserInfo {
  user_id: string;
  nickname: string;
  card?: string;
  role?: string;
}

/**
 * 权限服务接口
 */
import type { PermissionService } from './built/permission.js';
/**
 * 配置服务接口
 */
import type { ConfigService } from './built/config.js';

export { PermissionService, ConfigService };
/**
 * 群组信息结构
 */
export interface Group {
  group_id: string;
  group_name: string;
  member_count: number;
}

/** 消息中间件函数 */
export type MessageMiddleware<P extends RegisteredAdapter=RegisteredAdapter> = (message: Message<AdapterMessage<P>>, next: () => Promise<void>) => MaybePromise<void>;


/**
 * defineConfig辅助类型，支持函数式/对象式配置
 */
export type DefineConfig<T> = T | ((env:Record<string,string>)=>MaybePromise<T>);

export interface SendOptions extends MessageChannel{
  context:string
  bot:string
  content:SendContent
}

// export type PermissionChecker<T extends RegisteredAdapter = RegisteredAdapter> = (name: string, message: Message<AdapterMessage<T>>) => MaybePromise<boolean>
// export type PermissionItem<T extends RegisteredAdapter = RegisteredAdapter> = {
//    name: string | RegExp
//    check: PermissionChecker<T>
// }
export interface ProcessMessage {
  type: string;
  pid?: number;
  body: any;
}
export type QueueItem = {
  action: string;
  payload: any;
};
export type BeforeSendHandler=(options:SendOptions)=>MaybePromise<SendOptions|void>