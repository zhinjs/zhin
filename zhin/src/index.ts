import CM from './plugins/commandParser';
import ECHO from './plugins/echo';
import PM from './plugins/pluginManager';
import HMR from './plugins/hmr';
import SETUP from './plugins/setup';
export * from '@zhinjs/core';
export * from './adapters';
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
} from './plugins/setup';
export const commandParser = CM;
export const echo = ECHO;
export const pluginManager = PM;
export const hmr = HMR;
export const setup = SETUP;
export const version = require('../package.json').version;
export * from './worker';
