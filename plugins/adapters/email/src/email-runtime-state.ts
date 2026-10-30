/**
 * Email 插件实例的运行时状态：adapter create() 注册的 endpoint 列表。
 * Email 的 SMTP/IMAP 配置是嵌套结构，Console 只展示、不提供字段表单。
 */
import { defineEndpointRuntimeStateToken } from 'zhin.js/adapter';

export const emailRuntimeStateToken = defineEndpointRuntimeStateToken('email');
