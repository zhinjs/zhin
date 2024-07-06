import path from 'path';
import * as fs from 'fs';
export {
  useContext,
  getAdapter,
  getBot,
  registerCommand,
  registerMiddleware,
  sendGroupMessage,
  sendPrivateMessage,
  sendGuildMessage,
  sendDirectMessage,
  onMount,
  onUnmount,
  listenEvent,
  definePluginOptions,
  withService,
} from './plugins/setup';
export * from './constants';
import {
  axios,
  aesDecrypt,
  aesEncrypt,
  createApp,
  formatTime,
  formatSize,
  defineCommand,
  formatDateTime,
  parseFromTemplate,
  getCallerStack,
  wrapExport,
  loadModule,
  evaluate,
  findLastIndex,
  isMac,
  getDataKeyOfObj,
  getValueOfObj,
  getValueWithRuntime,
  parseObjFromStr,
  setValueToObj,
  stringifyObj,
  isMobile,
  compiler,
  defineConfig,
  deepClone,
  execute,
  deepMerge,
  isEmpty,
  remove,
  trimQuote,
  segment,
  isLinux,
  isWin,
  App,
  Adapter,
  ArgsType,
  APP_KEY,
  AdapterReceive,
  AdapterBot,
  Command,
  Message,
  Middleware,
  MessageBase,
  ParseArgType,
  OptionValueType,
  PluginMap,
  ParseOptionType,
  Bot,
  Compose,
  Dict,
  WORK_DIR,
  HOME_DIR,
  TEMP_DIR,
  REQUIRED_KEY,
  Plugin,
  NumString,
  Merge,
  LogLevel,
  Logger,
  HelpOptions,
  OptionsType,
  OptionType,
  Element,
  Schema,
} from '@zhinjs/core';
export * from './worker';
export async function initialApp(this: App) {
  const userAdapterDir = path.join(WORK_DIR, 'adapters');
  const userPluginDir = path.join(WORK_DIR, 'plugins');
  if (!fs.existsSync(userAdapterDir)) fs.mkdirSync(userAdapterDir);
  if (!fs.existsSync(userPluginDir)) fs.mkdirSync(userPluginDir);
  this.config.adapters.push('processAdapter');
  this.config.db_driver = 'level';
  this.config.db_init_args = [
    'zhin.db',
    {
      valueEncoding: 'json',
      createIfMissing: true,
    },
  ];
  this.config.plugins.push('commandParser', 'echo', 'hmr', 'zhinManager', 'setup');
  this.config.plugin_dirs.push(
    path.relative(WORK_DIR, path.join(__dirname, 'plugins')), // 内置
    path.relative(WORK_DIR, path.join(WORK_DIR, 'node_modules', '@zhinjs')), // 官方
    path.relative(WORK_DIR, userPluginDir), // 用户自定义
    path.relative(WORK_DIR, path.join(WORK_DIR, 'node_modules')), // 社区
  );
  this.config.adapter_dirs.push(
    path.relative(WORK_DIR, path.join(__dirname, 'adapters')), // 内置
    path.relative(WORK_DIR, userAdapterDir), // 用户自定义
    path.relative(WORK_DIR, path.join(WORK_DIR, 'node_modules')), // 社区
  );
  this.config.bots.push({ adapter: 'process', unique_id: 'developer', title: '终端' });
}
export {
  axios,
  aesDecrypt,
  aesEncrypt,
  createApp,
  formatTime,
  formatSize,
  defineCommand,
  formatDateTime,
  parseFromTemplate,
  getCallerStack,
  wrapExport,
  loadModule,
  evaluate,
  findLastIndex,
  isMac,
  getDataKeyOfObj,
  getValueOfObj,
  getValueWithRuntime,
  parseObjFromStr,
  setValueToObj,
  stringifyObj,
  isMobile,
  compiler,
  defineConfig,
  deepClone,
  execute,
  deepMerge,
  isEmpty,
  remove,
  trimQuote,
  segment,
  isLinux,
  isWin,
  App,
  Adapter,
  ArgsType,
  APP_KEY,
  AdapterReceive,
  AdapterBot,
  Command,
  Message,
  Middleware,
  MessageBase,
  ParseArgType,
  OptionValueType,
  PluginMap,
  ParseOptionType,
  Bot,
  Compose,
  Dict,
  WORK_DIR,
  HOME_DIR,
  TEMP_DIR,
  REQUIRED_KEY,
  Plugin,
  NumString,
  Merge,
  LogLevel,
  Logger,
  HelpOptions,
  OptionsType,
  OptionType,
  Element,
  Schema,
};
