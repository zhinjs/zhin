import { createToken } from '@zhin.js/plugin-runtime';
import { LoginAssist } from '../../built/login-assist.js';

/**
 * Plugin Runtime login-assist port（与 messageGatewayToken / sideEventGatewayToken 并列）。
 * 适配器 waitForInput；Console / stdin 经 listPending + submit 消费。
 */
export const loginAssistToken = createToken<LoginAssist>('zhin.im.login-assist');
