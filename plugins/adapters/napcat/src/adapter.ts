/**
 * NapCat 适配器：支持正向 WS / 反向 WS / HTTP
 */
import { formatCompact, Adapter, Plugin, OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL } from 'zhin.js';
import type { Router } from '@zhin.js/host-router';
import { NapCatWsClient } from './endpoint-ws-client.js';
import { NapCatWsServer } from './endpoint-ws-server.js';
import { NapCatHttpEndpoint } from './endpoint-http.js';
import type { NapCatEndpointConfig, NapCatWsClientConfig, NapCatWsServerConfig, NapCatHttpConfig } from './types.js';

export type NapCatEndpoint = NapCatWsClient | NapCatWsServer | NapCatHttpEndpoint;

export class NapCatAdapter extends Adapter<NapCatEndpoint> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;
  static override outboundRichSegmentPolicy = OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL;

  #router?: Router;

  constructor(plugin: Plugin) {
    super(plugin, 'napcat', []);
  }

  createEndpoint(config: NapCatEndpointConfig): NapCatEndpoint {
    const connection = config.connection ?? 'ws';
    switch (connection) {
      case 'ws':
        return new NapCatWsClient(this, config as NapCatWsClientConfig);
      case 'wss':
        if (!this.#router) throw new Error('NapCat connection: wss requires router. Enable @zhin.js/host-router first.');
        return new NapCatWsServer(this, this.#router, config as NapCatWsServerConfig);
      case 'http':
        if (!this.#router) throw new Error('NapCat connection: http requires router. Enable @zhin.js/host-router first.');
        return new NapCatHttpEndpoint(this, this.#router, config as NapCatHttpConfig);
      default:
        throw new Error(`Unknown NapCat connection: ${connection}`);
    }
  }

  // ── 群管理接口（IGroupManagement 适配）──────────────────────────

  async kickMember(endpointId: string, sceneId: string, userId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} not found`);
    return endpoint.kickMember(Number(sceneId), Number(userId));
  }

  async muteMember(endpointId: string, sceneId: string, userId: string, duration = 600) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} not found`);
    return endpoint.muteMember(Number(sceneId), Number(userId), duration);
  }

  async muteAll(endpointId: string, sceneId: string, enable = true) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} not found`);
    return endpoint.muteAll(Number(sceneId), enable);
  }

  async setAdmin(endpointId: string, sceneId: string, userId: string, enable = true) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} not found`);
    return endpoint.setAdmin(Number(sceneId), Number(userId), enable);
  }

  async setMemberNickname(endpointId: string, sceneId: string, userId: string, nickname: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} not found`);
    return endpoint.setCard(Number(sceneId), Number(userId), nickname);
  }

  async setGroupName(endpointId: string, sceneId: string, name: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} not found`);
    return endpoint.setGroupName(Number(sceneId), name);
  }

  async listMembers(endpointId: string, sceneId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} not found`);
    const members = await endpoint.getMemberList(Number(sceneId));
    return {
      members: members.map((m: any) => ({
        user_id: m.user_id, nickname: m.nickname, card: m.card, role: m.role, title: m.title,
      })),
      count: members.length,
    };
  }

  async getGroupInfo(endpointId: string, sceneId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} not found`);
    return endpoint.getGroupInfo(Number(sceneId));
  }

  async start(): Promise<void> {
    this.#router = (this.plugin.inject as (key: string) => Router | undefined)('router');
    (this.plugin.useContext as (key: string, fn: (router: Router) => void) => void)('router', (router: Router) => {
      this.#router = router;
    });
    await super.start();
  }
}
