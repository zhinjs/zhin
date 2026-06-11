/**
 * 微信公众号适配器
 */
import { Adapter, Plugin } from "zhin.js";
import type { Router } from "@zhin.js/host-router";
import { WeChatMPEndpoint } from "./endpoint.js";
import type { WeChatMPConfig } from "./types.js";

export class WeChatMPAdapter extends Adapter<WeChatMPEndpoint> {
    static override readonly capabilities = ['inbound', 'outbound'] as const;

    #router: Router;

    constructor(plugin: Plugin, router: Router) {
        super(plugin, 'wechat-mp', []);
        this.#router = router;
    }

    createEndpoint(config: WeChatMPConfig): WeChatMPEndpoint {
        return new WeChatMPEndpoint(this, this.#router, config);
    }
}
