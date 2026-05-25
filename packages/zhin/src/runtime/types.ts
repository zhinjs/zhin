import type { ConfigFeature, Plugin } from '@zhin.js/core';
import type { AppConfig } from '../types.js';

export type BootstrapOptions = {
  /** 机器人项目根（加载 zhin.config 前 chdir） */
  projectRoot?: string;
  /** 默认 true：执行 connectBots（Node）/ loadPlugins 后 plugin.start() */
  autoStart?: boolean;
  /** Edge：与 zhin.config 合并的默认项（勿含 @zhin.js/http、@zhin.js/console） */
  configDefaults?: AppConfig;
  /** Edge：插件目录加载完成后、start 前（Workers 静态 import demo 等） */
  afterPluginsLoaded?: (plugin: import('@zhin.js/core').Plugin, appConfig: AppConfig) => Promise<void>;
};

export type HttpRuntimeConfig = {
  port: number;
  host: string;
  token: string;
  base: string;
  corsOrigins: string[];
  trustProxy: boolean;
};

export type EdgeRuntimeConfig = {
  queueBotId: string;
  consoleParity: 'host' | 'edge';
};

export type PreparedRuntime = {
  plugin: Plugin;
  configFeature: ConfigFeature;
  appConfig: AppConfig;
  configPath: string;
};

export type BootstrapNodeResult = PreparedRuntime & {
  plugin: Plugin;
  appConfig: AppConfig;
  configPath: string;
};

export type BootstrapEdgeResult = PreparedRuntime & {
  plugin: Plugin;
  appConfig: AppConfig;
  configPath: string;
  http: HttpRuntimeConfig;
  edge: EdgeRuntimeConfig;
  fetch: (req: globalThis.Request) => Promise<globalThis.Response>;
  getSandboxAdapter: () => import('@zhin.js/adapter-sandbox').SandboxWsHostAdapter;
};
