import type { ConfigFeature, Plugin } from '@zhin.js/core';
import type { AppConfig } from '../types.js';

export type BootstrapOptions = {
  /** 机器人项目根（加载 zhin.config 前 chdir） */
  projectRoot?: string;
  /** 默认 true：执行 connectBots 后 plugin.start() */
  autoStart?: boolean;
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
