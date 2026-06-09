/**
 * 微信 iLink（ClawBot）适配器
 */
import { Adapter, type Plugin } from "zhin.js";
import { WeixinIlinkBot } from "./bot.js";
import type { WeixinIlinkBotConfig } from "./types.js";

export class WeixinIlinkAdapter extends Adapter<WeixinIlinkBot> {
  constructor(plugin: Plugin) {
    super(plugin, "weixin-ilink", []);
  }

  createBot(config: WeixinIlinkBotConfig): WeixinIlinkBot {
    return new WeixinIlinkBot(this, config);
  }
}
