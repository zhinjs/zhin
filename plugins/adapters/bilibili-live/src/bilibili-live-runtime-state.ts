/**
 * Bilibili Live 插件实例的运行时状态：adapter create() 注册的 endpoint 列表。
 * 供 Console 页面与（未来的）endpoint 命令共享。
 */
import { defineEndpointRuntimeStateToken } from 'zhin.js/adapter';

export const bilibiliLiveRuntimeStateToken = defineEndpointRuntimeStateToken('bilibili-live');
