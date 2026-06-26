/**
 * 微信 iLink（ClawBot）适配器
 */
import { Adapter, type Plugin } from "zhin.js";
import { WeixinIlinkEndpoint } from "./endpoint.js";
import type { WeixinIlinkEndpointConfig } from "./types.js";
import type { OutboundRichSegmentPolicy } from "zhin.js";

export class WeixinIlinkAdapter extends Adapter<WeixinIlinkEndpoint> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;
  static override outboundRichSegmentPolicy: OutboundRichSegmentPolicy = {
    qrcode: 'image',
    html: 'text',
    markdown: 'origin',
  };
  static override interactivePolicy = 'text' as const;

  constructor(plugin: Plugin) {
    super(plugin, "weixin-ilink", []);
  }

  createEndpoint(config: WeixinIlinkEndpointConfig): WeixinIlinkEndpoint {
    return new WeixinIlinkEndpoint(this, config);
  }
}
