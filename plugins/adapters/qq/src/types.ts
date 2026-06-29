/**
 * QQ 官方机器人适配器类型定义
 */
import type { Bot as QQOfficialBot } from "qq-official-bot";
import type { ReceiverMode, ApplicationPlatform } from "qq-official-bot";

export { ReceiverMode } from "qq-official-bot";
export type { ApplicationPlatform, Intent } from "qq-official-bot";

export type QQEndpointConfig<
  T extends ReceiverMode,
  M extends ApplicationPlatform = ApplicationPlatform,
> = QQOfficialBot.Config<T, M> & {
  context: "qq";
  name: string;
  data_dir?: string;
  /**
   * middleware 模式：挂在 host-router 的回调路径（默认 `/qq/webhook`，完整 URL 为 `{host}:8086/qq/webhook`，无 `/api` 前缀）。
   * webhook 独立端口模式：使用 qq-official-bot 的 `path` 字段。
   */
  webhookPath?: string;
  /**
   * 自定义 access token 接口（完整 URL）。
   * 默认 `https://bots.qq.com/app/getAppAccessToken`；代理或私有部署时可覆盖。
   */
  accessTokenUrl?: string;
  /**
   * 自定义 gateway 接口（完整 URL 或相对路径，如 `/gateway/bot`）。
   * 响应中的 `url` 为 WebSocket 地址；**仅 `mode: websocket` 入站时使用**。
   */
  gatewayUrl?: string;
  /**
   * AI 出站是否转为 QQ Markdown（`msg_type=2`）。
   * - `auto`（默认）：正文含 Markdown 语法时转换
   * - `true`：纯文本也走 Markdown
   * - `false`：保持纯文本
   */
  outboundMarkdown?: boolean | "auto";
  /** 本 Endpoint AI 访问控制（见 docs/advanced/content-moderation.md） */
  aiAccess?: {
    mode?: 'open' | 'closed' | 'whitelist';
    users?: string[];
    groups?: string[];
    denyMessage?: string;
  };
};

export interface QQEndpoint<
  T extends ReceiverMode,
  M extends ApplicationPlatform = ApplicationPlatform,
> {
  $config: QQEndpointConfig<T, M>;
}
