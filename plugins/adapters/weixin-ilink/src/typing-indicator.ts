/**
 * 微信 iLink Typing Indicator（iLink sendTyping API → 微信「正在输入」）
 */
import type { WeixinIlinkEndpoint } from "./endpoint.js";
import {
  NativeTypingIndicatorAdapter,
  TypingIndicatorManager,
  type TypingIndicator,
  type TypingIndicatorConfig,
  type TypingIndicatorOptions,
} from "@zhin.js/agent";
import { TypingStatus } from "./ilink-types.js";

export interface WeixinIlinkTypingIndicatorConfig {
  enabled?: boolean;
  /** sendTyping 保活间隔（ms），长任务期间重复发送；默认 5000 */
  keepaliveIntervalMs?: number;
  privateConfig?: Partial<TypingIndicatorConfig>;
}

const DEFAULT_CONFIG: WeixinIlinkTypingIndicatorConfig = {
  enabled: true,
  keepaliveIntervalMs: 5_000,
  privateConfig: {
    type: "typing",
    autoRemove: true,
    platformConfig: { keepaliveIntervalMs: 5_000 },
  },
};

export class WeixinIlinkTypingIndicatorManager {
  private manager: TypingIndicatorManager;
  private config: WeixinIlinkTypingIndicatorConfig;
  private endpoint: WeixinIlinkEndpoint;

  constructor(endpoint: WeixinIlinkEndpoint, config: WeixinIlinkTypingIndicatorConfig = {}) {
    this.endpoint = endpoint;
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      privateConfig: {
        ...DEFAULT_CONFIG.privateConfig,
        ...config.privateConfig,
        platformConfig: {
          keepaliveIntervalMs: config.keepaliveIntervalMs ?? DEFAULT_CONFIG.keepaliveIntervalMs,
          ...config.privateConfig?.platformConfig,
        },
      },
    };

    this.manager = new TypingIndicatorManager({
      type: "typing",
      autoRemove: true,
    });
    this.registerAdapter();
  }

  private registerAdapter(): void {
    const adapter = new NativeTypingIndicatorAdapter(
      "weixin-ilink",
      async (options: TypingIndicatorOptions) => {
        const peerId = resolvePeerId(options);
        if (!peerId) return;
        await this.endpoint.sendTypingToUser(peerId, TypingStatus.TYPING);
      },
      async (options: TypingIndicatorOptions) => {
        const peerId = resolvePeerId(options);
        if (!peerId) return;
        await this.endpoint.sendTypingToUser(peerId, TypingStatus.CANCEL);
      },
    );
    this.manager.registerAdapter(adapter);
  }

  async start(options: {
    messageId?: string;
    sessionId: string;
    userId?: string;
    groupId?: string;
    sceneType: "private" | "group";
  }): Promise<TypingIndicator> {
    if (!this.config.enabled) {
      return {
        start: async () => {},
        stop: async () => {},
        isActive: () => false,
      };
    }

    const peerId = resolvePeerId(options);
    const typingOptions: TypingIndicatorOptions = {
      messageId: options.messageId,
      sessionId: options.sessionId,
      userId: peerId,
      groupId: options.groupId,
      platform: "weixin-ilink",
      endpointId: this.endpoint.$id,
      sceneType: "private",
    };

    return this.manager.start(typingOptions, this.config.privateConfig);
  }

  async stop(options: {
    sessionId: string;
    userId?: string;
    groupId?: string;
  }): Promise<void> {
    const peerId = resolvePeerId(options);
    await this.manager.stop({
      sessionId: options.sessionId,
      userId: peerId,
      groupId: options.groupId,
      platform: "weixin-ilink",
      endpointId: this.endpoint.$id,
      sceneType: "private",
    });
  }
}

function resolvePeerId(options: {
  userId?: string;
  sessionId?: string;
}): string | undefined {
  const raw = options.userId?.trim()
    || (options.sessionId ? options.sessionId.split(":").filter(Boolean).at(-1) : undefined);
  if (!raw) return undefined;
  const hash = raw.indexOf("#");
  return hash >= 0 ? raw.slice(0, hash) : raw;
}

export function enableTypingIndicator(
  endpoint: WeixinIlinkEndpoint,
  config?: WeixinIlinkTypingIndicatorConfig,
): WeixinIlinkTypingIndicatorManager {
  const manager = new WeixinIlinkTypingIndicatorManager(endpoint, config);
  endpoint.$typingIndicator = manager;
  return manager;
}
