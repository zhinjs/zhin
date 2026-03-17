/**
 * 微信公众号适配器
 */
import { Adapter, Plugin } from "zhin.js";
import type { Router } from "@zhin.js/http";
import { WeChatMPBot } from "./bot.js";
import type { WeChatMPConfig } from "./types.js";

export class WeChatMPAdapter extends Adapter<WeChatMPBot> {
    #router: Router;

    constructor(plugin: Plugin, router: Router) {
        super(plugin, 'wechat-mp', []);
        this.#router = router;
    }

    createBot(config: WeChatMPConfig): WeChatMPBot {
        return new WeChatMPBot(this, this.#router, config);
    }
}
