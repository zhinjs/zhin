/**
 * Milky 适配器：单一适配器支持 WS 正向 / SSE / Webhook / 反向 WS，由 config.connection 区分
 */
import { formatCompact, Adapter, Plugin, type ISceneManagement, OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL, ONEBOT_KEYBOARD_AI_OUTBOUND_EXTENSION } from 'zhin.js';
import type { Router } from '@zhin.js/host-router';
import { MilkyWsClient } from './endpoint-ws.js';
import { MilkySseClient } from './endpoint-sse.js';
import { MilkyWebhookEndpoint } from './endpoint-webhook.js';
import { MilkyWssServer } from './endpoint-wss.js';
import type {
  MilkyEndpointConfig,
  MilkyWsConfig,
  MilkySseConfig,
  MilkyWebhookConfig,
  MilkyWssConfig,
} from './types.js';

export type MilkyBot = MilkyWsClient | MilkySseClient | MilkyWebhookEndpoint | MilkyWssServer;

export class MilkyAdapter extends Adapter<MilkyBot> {
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
    super(plugin, 'milky', []);
  }

  createEndpoint(config: MilkyEndpointConfig): MilkyBot {
    switch (config.connection) {
      case 'ws':
        return new MilkyWsClient(this, config as MilkyWsConfig);
      case 'sse':
        return new MilkySseClient(this, config as MilkySseConfig);
      case 'webhook':
        if (!this.#router) throw new Error('Milky connection: webhook 需要 router，请安装并在配置中启用 @zhin.js/host-router');
        return new MilkyWebhookEndpoint(this, this.#router, config as MilkyWebhookConfig);
      case 'wss':
        if (!this.#router) throw new Error('Milky connection: wss 需要 router，请安装并在配置中启用 @zhin.js/host-router');
        return new MilkyWssServer(this, this.#router, config as MilkyWssConfig);
      default:
        throw new Error(`Unknown Milky connection: ${(config as MilkyEndpointConfig).connection}`);
    }
  }

  async removeMember(endpointId: string, sceneId: string, userId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.kickMember(Number(sceneId), Number(userId), false);
  }

  async muteMember(endpointId: string, sceneId: string, userId: string, duration = 600) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.muteMember(Number(sceneId), Number(userId), duration);
  }

  async setSceneMuted(endpointId: string, sceneId: string, enable = true) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.muteAll(Number(sceneId), enable);
  }

  async setModerator(endpointId: string, sceneId: string, userId: string, enable = true) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.setAdmin(Number(sceneId), Number(userId), enable);
  }

  async setMemberNickname(endpointId: string, sceneId: string, userId: string, nickname: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.setCard(Number(sceneId), Number(userId), nickname);
  }

  async renameScene(endpointId: string, sceneId: string, name: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.setGroupName(Number(sceneId), name);
  }

  async listMembers(endpointId: string, sceneId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    const members = await endpoint.getMemberList(Number(sceneId));
    return { members: Array.isArray(members) ? members : [], count: Array.isArray(members) ? members.length : 0 };
  }

  async getSceneInfo(endpointId: string, sceneId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.getGroupInfo(Number(sceneId));
  }

  async start(): Promise<void> {
    // 同步获取已就绪的 router，或通过 useContext 在 router 挂载后赋值
    this.#router = (this.plugin.inject as (key: string) => Router | undefined)('router');
    (this.plugin.useContext as (key: string, fn: (router: Router) => void) => void)('router', (router: Router) => {
      this.#router = router;
    });
    await super.start();
  }
}
