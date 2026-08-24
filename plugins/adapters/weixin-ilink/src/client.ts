import { getContextToken } from './context-store.js';
import type { WeixinIlinkCredentials } from './credentials.js';
import { sendTyping } from './ilink-api.js';
import type { WeixinConfigManager } from './ilink-config-cache.js';
import type { ResolvedWeixinIlinkConfig } from './protocol.js';
import { sendMessageWeixin } from './weixin-send.js';
import { sendWeixinMediaFile } from './weixin-send-media.js';
import { defineEndpointClient } from 'zhin.js/adapter';

/** Direct iLink API client backed by the Endpoint's live authenticated session. */
export class WeixinIlinkClient {
  constructor(
    readonly config: ResolvedWeixinIlinkConfig,
    private readonly resolveCredentials: () => WeixinIlinkCredentials | null,
    private readonly resolveConfigManager: () => WeixinConfigManager | undefined,
    private readonly sendTextImpl: typeof sendMessageWeixin,
  ) {}

  get credentials(): WeixinIlinkCredentials {
    const credentials = this.resolveCredentials();
    if (!credentials?.botToken) throw new Error('weixin-ilink client not authenticated');
    return credentials;
  }

  get authenticated(): boolean {
    return Boolean(this.resolveCredentials()?.botToken);
  }

  get apiBaseUrl(): string {
    return this.resolveCredentials()?.baseUrl ?? this.config.baseUrl;
  }

  get cdnBaseUrl(): string {
    return this.config.cdnBaseUrl;
  }

  contextToken(userId: string): string | undefined {
    return getContextToken(this.config.id, userId);
  }

  async sendText(to: string, text: string): Promise<{ messageId: string }> {
    const contextToken = this.contextToken(to);
    if (!contextToken) throw new Error(`missing context_token for peer ${to}`);
    return this.sendTextImpl({
      to,
      text,
      opts: { baseUrl: this.apiBaseUrl, token: this.credentials.botToken, contextToken },
    });
  }

  async sendMedia(to: string, filePath: string, text = ''): Promise<{ messageId: string }> {
    const contextToken = this.contextToken(to);
    if (!contextToken) throw new Error(`missing context_token for peer ${to}`);
    return sendWeixinMediaFile({
      filePath,
      to,
      text,
      opts: { baseUrl: this.apiBaseUrl, token: this.credentials.botToken, contextToken },
      cdnBaseUrl: this.cdnBaseUrl,
    });
  }

  async sendTyping(userId: string, status: number): Promise<boolean> {
    const manager = this.resolveConfigManager();
    if (!this.authenticated || !manager) return false;
    const cfg = await manager.getForUser(userId, this.contextToken(userId));
    if (!cfg.typingTicket) return false;
    await sendTyping({
      baseUrl: this.apiBaseUrl,
      token: this.credentials.botToken,
      body: { ilink_user_id: userId, typing_ticket: cfg.typingTicket, status },
    });
    return true;
  }
}

export type WeixinIlinkClientEventMap = Record<string, unknown>;

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly 'weixin-ilink': { readonly client: WeixinIlinkClient; readonly events: WeixinIlinkClientEventMap };
  }
}

export const weixinIlinkClient = defineEndpointClient<WeixinIlinkClient, WeixinIlinkClientEventMap>('weixin-ilink');
