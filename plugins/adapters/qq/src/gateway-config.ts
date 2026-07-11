import { formatCompact, type Logger } from '@zhin.js/logger';

import { ReceiverMode, type Bot as QQOfficialBot } from 'qq-official-bot';

import type { QQEndpointConfig } from "./types.js";

/** qq-official-bot 默认 token 接口 */
export const DEFAULT_ACCESS_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
/** qq-official-bot 默认 gateway 路径（相对 API baseURL） */
export const DEFAULT_GATEWAY_URL = "/gateway/bot";

type AuthManagerSession = {
  authManager: {
    config: {
      accessTokenUrl?: string;
      gatewayUrl?: string;
    };
  };
};

/**
 * 将自定义 gateway / token 地址注入 SDK Auth。
 * SDK 仅在 websocket 模式自动读取配置；middleware / webhook 需在此补丁。
 */
export function applyCustomAuthEndpoints(
  endpoint: QQOfficialBot,
  config: Pick<QQEndpointConfig<ReceiverMode>, "mode" | "accessTokenUrl" | "gatewayUrl">,
  logger: Logger,
): void {
  const { accessTokenUrl, gatewayUrl, mode } = config;
  if (!accessTokenUrl && !gatewayUrl) return;

  if (mode !== ReceiverMode.WEBSOCKET) {
    const session = endpoint.sessionManager as unknown as AuthManagerSession;
    if (accessTokenUrl) session.authManager.config.accessTokenUrl = accessTokenUrl;
    if (gatewayUrl) session.authManager.config.gatewayUrl = gatewayUrl;
  }

  logger.debug(formatCompact({
    op: "qq_gateway",
    mode,
    accessTokenUrl: accessTokenUrl ?? DEFAULT_ACCESS_TOKEN_URL,
    gatewayUrl: gatewayUrl ?? DEFAULT_GATEWAY_URL,
    note: mode === ReceiverMode.WEBSOCKET
      ? "websocket 入站使用 gatewayUrl"
      : "middleware/webhook 仅 accessTokenUrl 生效",
  }));
}
