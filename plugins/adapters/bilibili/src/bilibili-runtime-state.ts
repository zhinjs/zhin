/**
 * Bilibili 插件实例的运行时状态：adapter create() 注册的 endpoint 列表。
 */
import { defineEndpointRuntimeStateToken } from 'zhin.js/adapter';

export const bilibiliRuntimeStateToken = defineEndpointRuntimeStateToken('bilibili');
