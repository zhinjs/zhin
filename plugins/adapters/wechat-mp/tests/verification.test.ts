/**
 * 微信公众号 URL 验证（明文 / 安全模式）
 */
import { describe, it, expect } from "vitest";
import { Plugin } from "zhin.js";
import { createHash } from "crypto";
import { WeChatMPAdapter } from "../src/adapter.js";
import { WeChatMPBot } from "../src/bot.js";

type BotInternals = {
  verifySignature: (params: {
    signature: string;
    timestamp: string;
    nonce: string;
    echostr?: string;
  }) => boolean;
  decryptEchostr: (encrypted: string) => string;
  isEncryptedEchostr: (echostr: string) => boolean;
  buildTextReply: (
    msg: { FromUserName: string; ToUserName: string },
    text: string,
  ) => string;
  encryptMessage: (replyXml: string, requestTimestamp?: string) => string;
  decryptMessage: (
    encryptedXml: string,
    msgSignature: string,
    timestamp: string,
    nonce: string,
  ) => Promise<string>;
};

function createBot(config: Partial<import("../src/types.js").WeChatMPConfig> = {}) {
  const plugin = new Plugin("/test/wechat-mp-verification.ts");
  const mockRouter = { post: () => {}, get: () => {} };
  const adapter = new WeChatMPAdapter(plugin, mockRouter as never);
  return new WeChatMPBot(adapter, mockRouter as never, {
    context: "wechat-mp",
    name: "verify-bot",
    appId: "wx5823bf96d3bd56c7",
    appSecret: "secret",
    token: "QDG6eK",
    path: "/wechat/webhook",
    encodingAESKey: "jWmYm7qr5nMoAUwZRjGtBxmz3KA1tkAj3ykkR6q2B2C",
    encrypt: true,
    ...config,
  }) as WeChatMPBot & BotInternals;
}

describe("WeChat MP URL verification", () => {
  it("明文模式：token + timestamp + nonce 签名校验", () => {
    const bot = createBot({
      appId: "wx-app",
      token: "plain-token",
      encrypt: false,
      encodingAESKey: undefined,
    });

    const timestamp = "1409659589";
    const nonce = "263014780";
    const signature = createHash("sha1")
      .update(["plain-token", timestamp, nonce].sort().join(""))
      .digest("hex");

    expect(bot.verifySignature({ signature, timestamp, nonce })).toBe(true);
    expect(bot.verifySignature({ signature: "bad", timestamp, nonce })).toBe(false);
  });

  it("安全模式：官方样例 msg_signature + echostr 解密", () => {
    const bot = createBot();

    const timestamp = "1409659589";
    const nonce = "263014780";
    const echostr =
      "P9nAzCzyDtyTWESHep1vC5X9xho/qYX3Zpb4yKa9SKld1DsH3Iyt3tP3zNdtp+4RPcs8TgAE7OaBO+FZXvnaqQ==";
    const msgSignature = "5c45ff5e21c57e6ad56bac8758b79b1d9ac89fd3";

    expect(bot.verifySignature({ signature: msgSignature, timestamp, nonce, echostr })).toBe(true);
    expect(bot.decryptEchostr(echostr)).toBe("1616140317555161061");
  });

  it("安全模式：公众平台 GET 用 signature(3 参数) + 加密 echostr", () => {
    const bot = createBot({ token: "zhinBot" });

    const timestamp = "1409659589";
    const nonce = "263014780";
    const signature = createHash("sha1")
      .update(["zhinBot", timestamp, nonce].sort().join(""))
      .digest("hex");
    const echostr =
      "P9nAzCzyDtyTWESHep1vC5X9xho/qYX3Zpb4yKa9SKld1DsH3Iyt3tP3zNdtp+4RPcs8TgAE7OaBO+FZXvnaqQ==";

    expect(bot.verifySignature({ signature, timestamp, nonce })).toBe(true);
    expect(
      bot.verifySignature({ signature, timestamp, nonce, echostr }),
    ).toBe(false);
    expect(bot.decryptEchostr(echostr)).toBe("1616140317555161061");
  });

  it("兼容模式：短明文 echostr 不应走 AES 解密", () => {
    const bot = createBot({ token: "zhinBot" });
    const plain = "1780907587411498236";

    expect(bot.isEncryptedEchostr(plain)).toBe(false);
    expect(bot.isEncryptedEchostr(
      "P9nAzCzyDtyTWESHep1vC5X9xho/qYX3Zpb4yKa9SKld1DsH3Iyt3tP3zNdtp+4RPcs8TgAE7OaBO+FZXvnaqQ==",
    )).toBe(true);
  });

  it("被动回复密文包可解密还原为原文", async () => {
    const bot = createBot({ token: "zhinBot" }) as WeChatMPBot & BotInternals;
    const plain = bot.buildTextReply(
      { FromUserName: "oUser", ToUserName: "gh_bot" },
      "hello",
    );
    const timestamp = "1714112445";
    const nonce = "415670741";
    const outer = bot.encryptMessage(plain, timestamp);

    const parsed = await import("xml2js").then((m) =>
      new m.Parser({ explicitArray: false }).parseStringPromise(outer),
    );
    const encrypt = parsed.xml.Encrypt as string;
    const msgSignature = createHash("sha1")
      .update(["zhinBot", timestamp, parsed.xml.Nonce as string, encrypt].sort().join(""))
      .digest("hex");

    const decrypted = await bot.decryptMessage(
      outer,
      msgSignature,
      timestamp,
      parsed.xml.Nonce as string,
    );
    expect(decrypted).toBe(plain);
  });
});
