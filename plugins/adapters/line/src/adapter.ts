/**
 * LINE 适配器
 */
import { Adapter,
  Plugin, OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL } from 'zhin.js';
import { LineEndpoint } from "./endpoint.js";
import type { LineEndpointConfig } from "./types.js";
import type { Router } from "@zhin.js/host-router/router";

export class LineAdapter extends Adapter<LineEndpoint> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;
  static override outboundRichSegmentPolicy = OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL;

  #router: Router;

  constructor(plugin: Plugin, router: Router) {
    super(plugin, "line", []);
    this.#router = router;
  }

  createEndpoint(config: LineEndpointConfig): LineEndpoint {
    return new LineEndpoint(this, this.#router, config);
  }

  async start(): Promise<void> {
    await super.start();
  }
}
