import { describe, it, expect } from "vitest";
import { Plugin } from "zhin.js";
import { WeChatMPAdapter } from "../src/adapter.js";
import { WeChatMPBot } from "../src/bot.js";

describe("WeChat MP passive reply XML", () => {
  it("buildTextReply 不应出现双层 <xml> 嵌套", () => {
    const plugin = new Plugin("/test/wechat-reply-xml.ts");
    const mockRouter = { post: () => {}, get: () => {} };
    const adapter = new WeChatMPAdapter(plugin, mockRouter as never);
    const bot = new WeChatMPBot(adapter, mockRouter as never, {
      context: "wechat-mp",
      name: "t",
      appId: "aid",
      appSecret: "sec",
      token: "tk",
      path: "/wechat/webhook",
    });

    const xml = (
      bot as unknown as {
        buildTextReply: (
          msg: { FromUserName: string; ToUserName: string },
          text: string,
        ) => string;
      }
    ).buildTextReply({ FromUserName: "oUser", ToUserName: "gh_bot" }, "hello");

    // 入站 FromUserName=用户 openid → 出站 ToUserName；入站 ToUserName=gh_ → 出站 FromUserName
    expect(xml).toContain("<ToUserName><![CDATA[oUser]]></ToUserName>");
    expect(xml).toContain("<FromUserName><![CDATA[gh_bot]]></FromUserName>");
    expect(xml).toContain("hello");
    expect(xml).toContain("<Content><![CDATA[hello]]></Content>");
    expect(xml.match(/<xml>/g)?.length).toBe(1);
    expect(xml).not.toMatch(/<xml>\s*<xml>/);
  });
});
