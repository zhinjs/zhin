import path from 'path';
import * as fs from 'fs';
export {
  useContext,
  adapter,
  middleware,
  command,
  sendGroupMessage,
  sendPrivateMessage,
  sendGuildMessage,
  sendDirectMessage,
  onMount,
  onUnmount,
  listen,
  options,
  required,
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
} from '@zhinjs/core';
export * from './worker';
export async function initialApp(this: App) {
  const userAdapterDir = path.join(WORK_DIR, 'adapters');
  const userPluginDir = path.join(WORK_DIR, 'plugins');
  if (!fs.existsSync(userAdapterDir)) fs.mkdirSync(userAdapterDir);
  if (!fs.existsSync(userPluginDir)) fs.mkdirSync(userPluginDir);
  this.jsondb.set('config.adapters', ['processAdapter']);
  this.jsondb.set('config.plugins', ['commandParser', 'echo', 'hmr', 'zhinManager', 'setup']);
  this.jsondb.set('config.plugin_dirs', [
    path.relative(WORK_DIR, path.join(__dirname, 'plugins')), // 内置
    path.relative(WORK_DIR, path.join(WORK_DIR, 'node_modules', '@zhinjs')), // 官方
    path.relative(WORK_DIR, userPluginDir), // 用户自定义
    path.relative(WORK_DIR, path.join(WORK_DIR, 'node_modules')), // 社区
  ]);
  this.jsondb.set('config.adapter_dirs', [
    path.relative(WORK_DIR, path.join(__dirname, 'adapters')), // 内置
    path.relative(WORK_DIR, userAdapterDir), // 用户自定义
    path.relative(WORK_DIR, path.join(WORK_DIR, 'node_modules')), // 社区
  ]);
  this.jsondb.set('config.bots', [{ adapter: 'process', unique_id: 'developer' }]);
  this.jsondb.set('config.disable_adapters', []);
  this.jsondb.set('config.disable_bots', []);
  this.jsondb.set('config.disable_plugins', []);
  this.jsondb.set('config.log_level', 'info');
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
};
