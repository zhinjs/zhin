/**
 * Email 适配器
 */
import { Adapter, Plugin } from "zhin.js";
import { EmailEndpoint } from "./endpoint.js";
import type { EmailEndpointConfig } from "./types.js";
import type { OutboundRichSegmentPolicy } from "zhin.js";

export class EmailAdapter extends Adapter<EmailEndpoint> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;
  static override outboundRichSegmentPolicy: OutboundRichSegmentPolicy = {
    qrcode: 'image',
    html: 'origin',
    markdown: 'image',
  };

    constructor(plugin: Plugin) {
        super(plugin, 'email', []);
    }

    createEndpoint(config: EmailEndpointConfig): EmailEndpoint {
        return new EmailEndpoint(this, config);
    }
}
