/**
 * weixin-ilink 适配器集成测试
 */
import { describe, it, expect, vi } from "vitest";
import { Plugin, segment, type SendOptions } from "zhin.js";
import { MessageItemType } from "../src/ilink-types.js";
import type { WeixinMessage } from "../src/ilink-types.js";
import { createAdapterTestSuite } from "../../../../packages/im/core/tests/adapter-harness.js";
import { WeixinIlinkAdapter } from "../src/adapter.js";
import { WeixinIlinkEndpoint } from "../src/endpoint.js";
import type { WeixinIlinkEndpointConfig } from "../src/types.js";
import { setContextToken } from "../src/context-store.js";

const FIXED_TS = 1700000000000;
const BOT_NAME = "test-bot";
const PEER_ID = "wx-user-001";

class MockWeixinIlinkEndpoint extends WeixinIlinkEndpoint {
  sendMock = vi.fn();

  constructor(adapter: WeixinIlinkAdapter, config: WeixinIlinkEndpointConfig) {
    super(adapter, config);
  }

  async $connect(): Promise<void> {
    this.$connected = true;
  }

  async $disconnect(): Promise<void> {
    this.$connected = false;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    this.sendMock(options);
    return `wx-ilink-msg-${Date.now()}`;
  }
}

class MockWeixinIlinkAdapter extends WeixinIlinkAdapter {
  createEndpoint(config: WeixinIlinkEndpointConfig): MockWeixinIlinkEndpoint {
    return new MockWeixinIlinkEndpoint(this, {
      context: "weixin-ilink",
      name: config.name || BOT_NAME,
      botToken: "mock-token",
      ...config,
    });
  }
}

function createWeixinRawEvent(overrides: Partial<WeixinMessage> = {}): WeixinMessage {
  return {
    message_id: 1001,
    from_user_id: PEER_ID,
    create_time_ms: FIXED_TS,
    context_token: "ctx-mock-token",
    item_list: [
      {
        type: MessageItemType.TEXT,
        text_item: { text: "你好世界" },
      },
    ],
    ...overrides,
  };
}

createAdapterTestSuite<MockWeixinIlinkAdapter, WeixinMessage>({
  adapterName: "weixin-ilink",
  endpointId: BOT_NAME,
  createAdapter: (plugin) => {
    const adapter = new MockWeixinIlinkAdapter(plugin);
    adapter.config = [
      {
        context: "weixin-ilink",
        name: BOT_NAME,
        botToken: "mock-token",
      },
    ];
    return adapter;
  },
  createRawEvent: () => createWeixinRawEvent(),
  setupEndpoint: (endpoint) => {
    setContextToken(BOT_NAME, PEER_ID, "ctx-mock-token");
    if (endpoint instanceof MockWeixinIlinkEndpoint) {
      vi.spyOn(endpoint, "$connect").mockResolvedValue(undefined);
      vi.spyOn(endpoint, "$disconnect").mockResolvedValue(undefined);
    }
  },
});

describe("WeixinIlinkEndpoint formatting", () => {
  it("formats text inbound message", () => {
    const plugin = new Plugin("/test/weixin-ilink");
    const adapter = new MockWeixinIlinkAdapter(plugin);
    const endpoint = adapter.createEndpoint({ context: "weixin-ilink", name: BOT_NAME, botToken: "t" });
    const msg = endpoint.$formatMessage(createWeixinRawEvent());
    expect(msg.$adapter).toBe("weixin-ilink");
    expect(msg.$channel.type).toBe("private");
    expect(msg.$channel.id).toBe(PEER_ID);
    expect(segment.raw(msg.$content)).toContain("你好世界");
  });
});

describe("WeixinIlinkEndpoint send guard", () => {
  it("refuses send without context_token", async () => {
    const plugin = new Plugin("/test/weixin-ilink");
    const adapter = new WeixinIlinkAdapter(plugin);
    const endpoint = new WeixinIlinkEndpoint(adapter, {
      context: "weixin-ilink",
      name: "no-ctx-bot",
      botToken: "t",
    });
    (endpoint as unknown as { creds: { botToken: string } }).creds = { botToken: "t" };
    await expect(
      endpoint.$sendMessage({
        type: "private",
        id: "unknown-peer",
        context: "weixin-ilink",
        endpoint: "no-ctx-bot",
        content: [{ type: "text", data: { text: "hi" } }],
      }),
    ).rejects.toThrow(/context_token/);
  });
});
