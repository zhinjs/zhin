/**
 * OneBot11 插件实例的运行时状态：adapter create() 注册的 endpoint 列表。
 * 由 plugin.ts setup() provide，adapter create 与 `onebot11.endpoint` 命令共享（同一 owner generation）。
 */
import { defineEndpointRuntimeStateToken } from '@zhin.js/adapter';

export const onebot11RuntimeStateToken = defineEndpointRuntimeStateToken('onebot11');
