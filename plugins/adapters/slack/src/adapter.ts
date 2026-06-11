/**
 * Slack 适配器
 */
import {
  Adapter,
  Plugin,
} from "zhin.js";
import { SlackEndpoint } from "./endpoint.js";
import type { SlackEndpointConfig } from "./types.js";

export class SlackAdapter extends Adapter<SlackEndpoint> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;

  constructor(plugin: Plugin) {
    super(plugin, "slack", []);
  }

  createEndpoint(config: SlackEndpointConfig): SlackEndpoint {
    return new SlackEndpoint(this, config);
  }

  // ── IGroupManagement 标准群管方法 ──────────────────────────────────

  async kickMember(endpointId: string, sceneId: string, userId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.kickFromChannel(sceneId, userId);
  }

  async setGroupName(endpointId: string, sceneId: string, name: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.renameChannel(sceneId, name);
  }

  async listMembers(endpointId: string, sceneId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.getChannelMembers(sceneId);
  }

  async getGroupInfo(endpointId: string, sceneId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.getChannelInfo(sceneId);
  }

  // ── 生命周期 ───────────────────────────────────────────────────────

  async start(): Promise<void> {
    await super.start();
  }

}
