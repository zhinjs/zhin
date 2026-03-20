import { Bot, DatabaseConfig, Databases, MessageFilterConfig, type DualRouteConfig } from "@zhin.js/core";
import { LogLevel } from "@zhin.js/logger";

/**
 * App配置类型，涵盖机器人、数据库、插件、调试等
 */
export interface AppConfig<T extends keyof Databases = keyof Databases> {
  bots?: Bot.Config[];
  log_level: LogLevel;
  /** 数据库配置列表 */
  database?: DatabaseConfig<T>;
  /** 插件目录列表，默认为 ['./plugins', 'node_modules'] */
  plugin_dirs?: string[];
  /** 需要加载的插件列表 */
  plugins?: string[];
  /** 启用的内置服务列表，例如 ['process','config','command','component','permission','cron'] */
  services?: ('process' | 'config' | 'command' | 'component' | 'permission' | 'cron')[];
  /** 禁用的依赖列表 */
  disable_dependencies?: string[];
  /** 是否启用调试模式 */
  debug?: boolean;
  /** 日志配置 */
  log?: {
    /** 最大日志保留天数，默认 7 天 */
    maxDays?: number;
    /** 最大日志条数，默认 10000 条 */
    maxRecords?: number;
    /** 自动清理间隔（小时），默认 24 小时 */
    cleanupInterval?: number;
  };
  /** 消息过滤配置 */
  message_filter?: MessageFilterConfig;
  /**
   * MessageDispatcher 双轨分流：指令与 AI 独立判定、顺序、是否双次回复等
   * @see @zhin.js/core createMessageDispatcher
   */
  dispatcher?: DualRouteConfig;
  /**
   * 统一收件箱：将各适配器的消息、请求、通知归一化后写入内置数据库。
   * 需同时配置 database 方可生效。
   */
  inbox?: {
    /** 是否启用统一收件箱存储，默认 false */
    enabled?: boolean;
  };
  /** 插件配置（键为插件名，值为配置对象） */
  [key: string]: any;
}

