import { Bot, DatabaseConfig, Databases } from "@zhin.js/core";
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
  /** 插件配置（键为插件名，值为配置对象） */
  [key: string]: any;
}

