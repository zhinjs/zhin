/**
 * 钉钉适配器
 */
import { Adapter,
  Plugin,, OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL } from 'zhin.js';
import { DingTalkEndpoint } from "./endpoint.js";
import type { DingTalkEndpointConfig } from "./types.js";

export class DingTalkAdapter extends Adapter<DingTalkEndpoint> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;
  static override outboundRichSegmentPolicy = OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL;

  #router: any;

  constructor(plugin: Plugin, router: any) {
    super(plugin, "dingtalk", []);
    this.#router = router;
  }

  createEndpoint(config: DingTalkEndpointConfig): DingTalkEndpoint {
    return new DingTalkEndpoint(this, this.#router, config);
  }

  async kickMember(endpointId: string, sceneId: string, userId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.updateChat(sceneId, { del_useridlist: [userId] });
  }

  async setGroupName(endpointId: string, sceneId: string, name: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.updateChat(sceneId, { name });
  }

  async getGroupInfo(endpointId: string, sceneId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.getChatInfo(sceneId);
  }

  async start(): Promise<void> {
    await super.start();
  }
}
