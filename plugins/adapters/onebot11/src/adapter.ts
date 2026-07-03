/**
 * OneBot11 适配器：单一适配器支持正向 WS / 反向 WS，由 config.connection 区分
 */
import { formatCompact, Adapter, Plugin, OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL, ONEBOT_KEYBOARD_AI_OUTBOUND_EXTENSION } from 'zhin.js';
import type { Router } from '@zhin.js/host-router';
import { OneBot11WsClient } from './endpoint-ws-client.js';
import { OneBot11WsServer } from './endpoint-ws-server.js';
import type {
  OneBot11WsClientConfig,
  OneBot11WsServerConfig,
  OneBot11EndpointConfig,
} from './types.js';

export type OneBot11Bot = OneBot11WsClient | OneBot11WsServer;

export class OneBot11Adapter extends Adapter<OneBot11Bot> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;
  static override outboundRichSegmentPolicy = OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL;
  static override interactivePolicy = 'text' as const;
  static override aiOutboundCapabilities = {
    mentions: true,
    richSegments: ['qrcode', 'html', 'markdown', 'tts'],
    interactive: 'text' as const,
  };
  static override aiOutboundExtensions = [ONEBOT_KEYBOARD_AI_OUTBOUND_EXTENSION];

  #router?: Router;

  constructor(plugin: Plugin) {
    super(plugin, 'onebot11', []);
  }

  createEndpoint(config: OneBot11EndpointConfig): OneBot11Bot {
    const connection = config.connection ?? 'ws';
    switch (connection) {
      case 'ws':
        return new OneBot11WsClient(this, config as OneBot11WsClientConfig);
      case 'wss':
        if (!this.#router) {
          throw new Error('OneBot11 connection: wss 需要 router，请安装并在配置中启用 @zhin.js/host-router');
        }
        return new OneBot11WsServer(this, this.#router, config as OneBot11WsServerConfig);
      default:
        throw new Error(`Unknown OneBot11 connection: ${connection}`);
    }
  }

  async kickMember(endpointId: string, sceneId: string, userId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.kickMember(Number(sceneId), Number(userId), false);
  }

  async muteMember(endpointId: string, sceneId: string, userId: string, duration = 600) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.muteMember(Number(sceneId), Number(userId), duration);
  }

  async muteAll(endpointId: string, sceneId: string, enable = true) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.muteAll(Number(sceneId), enable);
  }

  async setAdmin(endpointId: string, sceneId: string, userId: string, enable = true) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.setAdmin(Number(sceneId), Number(userId), enable);
  }

  async setMemberNickname(endpointId: string, sceneId: string, userId: string, nickname: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.setCard(Number(sceneId), Number(userId), nickname);
  }

  async setGroupName(endpointId: string, sceneId: string, name: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.setGroupName(Number(sceneId), name);
  }

  async listMembers(endpointId: string, sceneId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    const members = await endpoint.getMemberList(Number(sceneId));
    return {
      members: members.map((m: any) => ({
        user_id: m.user_id,
        nickname: m.nickname,
        card: m.card,
        role: m.role,
        title: m.title,
      })),
      count: members.length,
    };
  }

  async getGroupInfo(endpointId: string, sceneId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
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
