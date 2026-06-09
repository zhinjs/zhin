/**
 * weixin-ilink 适配器集成测试
 */
import { describe, it, expect, vi } from "vitest";
import { Plugin, segment, type SendOptions } from "zhin.js";
import { MessageItemType } from "../src/ilink-types.js";
import type { WeixinMessage } from "../src/ilink-types.js";
import { createAdapterTestSuite } from "../../../../packages/im/core/tests/adapter-harness.js";
import { WeixinIlinkAdapter } from "../src/adapter.js";
import { WeixinIlinkBot } from "../src/bot.js";
import type { WeixinIlinkBotConfig } from "../src/types.js";
import { setContextToken } from "../src/context-store.js";

const FIXED_TS = 1700000000000;
const BOT_NAME = "test-bot";
const PEER_ID = "wx-user-001";

class MockWeixinIlinkBot extends WeixinIlinkBot {
  sendMock = vi.fn();

  constructor(adapter: WeixinIlinkAdapter, config: WeixinIlinkBotConfig) {
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
  createBot(config: WeixinIlinkBotConfig): MockWeixinIlinkBot {
    return new MockWeixinIlinkBot(this, {
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
  botId: BOT_NAME,
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
  setupBot: (bot) => {
    setContextToken(BOT_NAME, PEER_ID, "ctx-mock-token");
    if (bot instanceof MockWeixinIlinkBot) {
      vi.spyOn(bot, "$connect").mockResolvedValue(undefined);
      vi.spyOn(bot, "$disconnect").mockResolvedValue(undefined);
    }
  },
});

describe("WeixinIlinkBot formatting", () => {
  it("formats text inbound message", () => {
    const plugin = new Plugin("/test/weixin-ilink");
    const adapter = new MockWeixinIlinkAdapter(plugin);
    const bot = adapter.createBot({ context: "weixin-ilink", name: BOT_NAME, botToken: "t" });
    const msg = bot.$formatMessage(createWeixinRawEvent());
    expect(msg.$adapter).toBe("weixin-ilink");
    expect(msg.$channel.type).toBe("private");
    expect(msg.$channel.id).toBe(PEER_ID);
    expect(segment.raw(msg.$content)).toContain("你好世界");
  });
});

describe("WeixinIlinkBot send guard", () => {
  it("refuses send without context_token", async () => {
    const plugin = new Plugin("/test/weixin-ilink");
    const adapter = new WeixinIlinkAdapter(plugin);
    const bot = new WeixinIlinkBot(adapter, {
      context: "weixin-ilink",
      name: "no-ctx-bot",
      botToken: "t",
    });
    (bot as unknown as { creds: { botToken: string } }).creds = { botToken: "t" };
    await expect(
      bot.$sendMessage({
        type: "private",
        id: "unknown-peer",
        context: "weixin-ilink",
        bot: "no-ctx-bot",
        content: [{ type: "text", data: { text: "hi" } }],
      }),
    ).rejects.toThrow(/context_token/);
  });
});
