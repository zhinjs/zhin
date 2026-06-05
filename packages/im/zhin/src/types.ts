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
  /** 插件目录列表，默认按 ['node_modules', './src/plugins'] 解析 */
  plugin_dirs?: string[];
  /** 需要加载的插件列表 */
  plugins?: string[];
  /** 启用的内置服务列表，例如 ['process','config','command','component','permission','cron'] */
  services?: ('process' | 'config' | 'command' | 'component' | 'permission' | 'cron')[];
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
   * MessageDispatcher 路由：默认与 createMessageDispatcher 一致（exclusive，命令与 AI 互斥）。
   * 若需双轨可同时命中指令与 AI，请设 mode: 'dual' 等，见 @zhin.js/core createMessageDispatcher
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
  /**
   * Assistant Runtime（Advanced / opt-in）：统一 JobStore，合并 cron-jobs 与 scheduler-jobs。
   * 见 docs/architecture/assistant-runtime.md
   */
  assistant?: {
    /** 启用 assistant-jobs.json 作为定时任务 SSOT，默认 false */
    enabled?: boolean;
    /** 双写 legacy cron-jobs.json，默认 true（M1 迁移期） */
    legacyDualWrite?: boolean;
    jobsFile?: string;
    /** M3：默认 notify（未显式指定时用于 Job 投递） */
    defaults?: {
      notify?: {
        channel: 'im' | 'silent' | 'log' | 'ha';
        platform?: string;
        botId?: string;
        senderId?: string;
        sceneId?: string;
        scope?: string;
        service?: string;
        target?: string;
      };
    };
    /** M4：Home Assistant 领域层 */
    home?: {
      enabled?: boolean;
      restUrl?: string;
      restToken?: string;
      mcpServer?: string;
      aliases?: Record<string, string>;
      policy?: {
        requireMaster?: boolean;
        confirmServices?: string[];
      };
    };
    /** M2：外部事件入口 POST /api/assistant/events，默认关闭 */
    events?: {
      enabled?: boolean;
      token?: string;
      allowedSources?: string[];
      rateLimitPerMinute?: number;
    };
    /** M5：Assistant Profile（persona / routines / defaults） */
    profile?: {
      enabled?: boolean;
      file?: string;
    };
    /** TaskQueue：Job 重试 / 并发（assistant.enabled 时默认开启） */
    queue?: {
      enabled?: boolean;
      maxConcurrency?: number;
      maxRetries?: number;
      defaultTimeoutMs?: number;
    };
  };
  /** 插件配置（键为插件名，值为配置对象） */
  [key: string]: any;
}

