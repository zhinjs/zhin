/**
 * Telegram 适配器
 */
import {
  Adapter,
  Plugin,
} from "zhin.js";
import { TelegramEndpoint } from "./endpoint.js";
import type { TelegramEndpointConfig } from "./types.js";

export class TelegramAdapter extends Adapter<TelegramEndpoint> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;

  constructor(plugin: Plugin) {
    super(plugin, "telegram", []);
  }

  createEndpoint(config: TelegramEndpointConfig): TelegramEndpoint {
    return new TelegramEndpoint(this, config);
  }

  // ── IGroupManagement 标准群管方法 ──────────────────────────────────

  async kickMember(endpointId: string, sceneId: string, userId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.kickMember(Number(sceneId), Number(userId));
  }

  async unbanMember(endpointId: string, sceneId: string, userId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.unbanMember(Number(sceneId), Number(userId));
  }

  async muteMember(endpointId: string, sceneId: string, userId: string, duration = 600) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.muteMember(Number(sceneId), Number(userId), duration);
  }

  async setAdmin(endpointId: string, sceneId: string, userId: string, enable = true) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.setAdmin(Number(sceneId), Number(userId), enable);
  }

  async setGroupName(endpointId: string, sceneId: string, name: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.setChatTitle(Number(sceneId), name);
  }

  async getGroupInfo(endpointId: string, sceneId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.getChatInfo(Number(sceneId));
  }

  // ── 生命周期 ───────────────────────────────────────────────────────

  async start(): Promise<void> {
    await super.start();
  }
}

