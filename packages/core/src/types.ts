import {MaybePromise}from '@zhin.js/types'
import {MessageChannel} from "./message.js";
import {Adapter} from "./adapter.js";
import {Bot,BotConfig} from "./bot.js";
import { Databases,Registry } from "@zhin.js/database";

/**
 * 类型定义文件：包含适配器、消息、数据库、配置等核心类型声明。
 * 协作者可通过本文件了解各主要数据结构的用途与关系。
 */
declare module '@zhin.js/types'{
  interface GlobalContext extends RegisteredAdapters{}
}
/**
 * 所有已注册适配器的类型映射（key为适配器名，value为Adapter实例）
 */
export interface RegisteredAdapters extends Record<string, Adapter>{}
/**
 * 数据库配置类型，支持多种数据库驱动
 */
export type DatabaseConfig<T extends keyof Databases=keyof Databases>={
  dialect:T
} & Registry.Config<Databases[T]>
/**
 * 获取对象所有value类型
 */
export type ObjectItem<T extends object>=T[keyof T]
/**
 * 已注册适配器名类型
 */
export type RegisteredAdapter=keyof RegisteredAdapters
/**
 * 指定适配器的消息类型
 */
export type AdapterMessage<T extends keyof RegisteredAdapters=keyof RegisteredAdapters>=RegisteredAdapters[T] extends Adapter<infer R>?BotMessage<R>:{}
/**
 * 指定适配器的配置类型
 */
export type AdapterConfig<T extends keyof RegisteredAdapters=keyof RegisteredAdapters>=RegisteredAdapters[T] extends Adapter<infer R>?PlatformConfig<R>:BotConfig
/**
 * Bot实例的配置类型
 */
export type PlatformConfig<T>=T extends Bot<infer L,infer R>?R:BotConfig
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
/**
 * 单个或数组类型
 */
export type MaybeArray<T>=T|T[]
/**
 * 消息发送内容类型
 */
export type SendContent=MaybeArray<string|MessageSegment>
/**
 * 消息发送者信息
 */
export interface MessageSender{
  id: string;
  name?: string;
}
/**
 * 通用字典类型
 */
export type Dict<V=any,K extends string|symbol=string>=Record<K, V>;
/**
 * 用户信息结构
 */
export interface User {
  user_id: string;
  nickname: string;
  card?: string;
  role?: string;
}

/**
 * 群组信息结构
 */
export interface Group {
  group_id: string;
  group_name: string;
  member_count: number;
}


/**
 * App配置类型，涵盖机器人、数据库、插件、调试等
 */
export interface AppConfig {
  /** 机器人配置列表 */
  bots?: BotConfig[];
  /** 数据库配置列表 */
  database?: DatabaseConfig;
  /** 插件目录列表，默认为 ['./plugins', 'node_modules'] */
  plugin_dirs?: string[];
  /** 需要加载的插件列表 */
  plugins?: string[];
  /** 禁用的依赖列表 */
  disable_dependencies?: string[];
  /** 是否启用调试模式 */
  debug?: boolean;
}
/**
 * defineConfig辅助类型，支持函数式/对象式配置
 */
export type DefineConfig<T> = T | ((env:Record<string,string>)=>MaybePromise<T>);

export interface SendOptions extends MessageChannel{
  context:string
  bot:string
  content:SendContent
}
export type BeforeSendHandler=(options:SendOptions)=>MaybePromise<SendOptions|void>