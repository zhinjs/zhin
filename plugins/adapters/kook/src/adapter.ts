/**
 * KOOK 适配器
 */
import { formatCompact, Adapter, Plugin } from 'zhin.js';
import { KookEndpoint } from "./endpoint.js";
import type { KookEndpointConfig } from "./types.js";
import type { OutboundRichSegmentPolicy } from "zhin.js";

export class KookAdapter extends Adapter<KookEndpoint> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;
  static override outboundRichSegmentPolicy: OutboundRichSegmentPolicy = {
    qrcode: 'image',
    html: 'image',
    markdown: 'origin',
  };
  static override interactivePolicy = 'native' as const;

  constructor(plugin: Plugin) {
    super(plugin, "kook", []);
  }

  createEndpoint(config: KookEndpointConfig): KookEndpoint {
    return new KookEndpoint(this, config);
  }

  // ── IGroupManagement 标准群管方法 ──────────────────────────────────

  async kickMember(endpointId: string, sceneId: string, userId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.kickUser(sceneId, userId);
  }

  async banMember(endpointId: string, sceneId: string, userId: string, reason?: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.addToBlacklist(sceneId, userId, reason);
  }

  async unbanMember(endpointId: string, sceneId: string, userId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.removeFromBlacklist(sceneId, userId);
  }

  async setMemberNickname(endpointId: string, sceneId: string, userId: string, nickname: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.setNickname(sceneId, userId, nickname);
  }

  async listMembers(endpointId: string, sceneId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    const members = await endpoint.getGuildMembers(sceneId);
    return {
      members: members.map(m => ({
        id: m.id, username: m.username,
        nickname: m.nickname, roles: m.roles,
      })),
      count: members.length,
    };
  }

  // ── 生命周期 ───────────────────────────────────────────────────────

  async start(): Promise<void> {
    await super.start();
  }

  async stop(): Promise<void> {
    await super.stop();
    this.plugin.logger.info(formatCompact( { op: "stop" }));
  }
}

