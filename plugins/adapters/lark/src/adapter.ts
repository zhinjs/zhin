/**
 * 飞书/Lark 适配器
 */
import { Adapter,
  Plugin, OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL } from 'zhin.js';
import { LarkEndpoint } from "./endpoint.js";
import type { LarkEndpointConfig } from "./types.js";

export class LarkAdapter extends Adapter<LarkEndpoint> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;
  static override outboundRichSegmentPolicy = OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL;

    #router: any;

    constructor(plugin: Plugin, router: any) {
        super(plugin, 'lark', []);
        this.#router = router;
    }

    createEndpoint(config: LarkEndpointConfig): LarkEndpoint {
        return new LarkEndpoint(this, this.#router, config);
    }

    // ── IGroupManagement 标准群管方法 ──────────────────────────────────

    async kickMember(endpointId: string, sceneId: string, userId: string) {
        const endpoint = this.endpoints.get(endpointId);
        if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
        return endpoint.removeChatMembers(sceneId, [userId]);
    }

    async listMembers(endpointId: string, sceneId: string) {
        const endpoint = this.endpoints.get(endpointId);
        if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
        return endpoint.getChatMembers(sceneId);
    }

    async getGroupInfo(endpointId: string, sceneId: string) {
        const endpoint = this.endpoints.get(endpointId);
        if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
        return endpoint.getChatInfo(sceneId);
    }

    async setGroupName(endpointId: string, sceneId: string, name: string) {
        const endpoint = this.endpoints.get(endpointId);
        if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
        return endpoint.updateChatInfo(sceneId, { name });
    }

    // ── 生命周期 ───────────────────────────────────────────────────────

    async start(): Promise<void> {
        await super.start();
    }

}
