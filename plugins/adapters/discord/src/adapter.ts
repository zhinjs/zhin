/**
 * Discord 适配器：单一适配器支持 Gateway / Interactions，由 config.connection 区分
 */
import { Adapter, Plugin, OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL } from 'zhin.js';
import type { Router } from "@zhin.js/host-router";
import { DiscordEndpoint } from "./endpoint.js";
import { DiscordInteractionsEndpoint } from "./endpoint-interactions.js";
import type {
  DiscordEndpointConfig,
  DiscordGatewayConfig,
  DiscordInteractionsConfig,
} from "./types.js";

export type DiscordEndpointLike = DiscordEndpoint | DiscordInteractionsEndpoint;

function isGatewayBot(endpoint: DiscordEndpointLike): endpoint is DiscordEndpoint {
  return (endpoint.$config as { connection?: string }).connection === "gateway";
}

export class DiscordAdapter extends Adapter<DiscordEndpointLike> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;
  static override outboundRichSegmentPolicy = OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL;

  #router?: Router;

  constructor(plugin: Plugin) {
    super(plugin, "discord", []);
  }

  createEndpoint(config: DiscordEndpointConfig): DiscordEndpointLike {
    const connection = config.connection ?? "gateway";
    switch (connection) {
      case "gateway":
        return new DiscordEndpoint(this, config as DiscordGatewayConfig);
      case "interactions":
        if (!this.#router) {
          throw new Error(
            "Discord connection: interactions 需要 router，请安装并在配置中启用 @zhin.js/host-router"
          );
        }
        return new DiscordInteractionsEndpoint(this, this.#router, config as DiscordInteractionsConfig);
      default:
        throw new Error(`Unknown Discord connection: ${(config as DiscordEndpointConfig).connection}`);
    }
  }

  async kickMember(endpointId: string, sceneId: string, userId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    if (!isGatewayBot(endpoint)) throw new Error("群管仅支持 connection: gateway");
    return endpoint.kickMember(sceneId, userId);
  }

  async banMember(endpointId: string, sceneId: string, userId: string, reason?: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    if (!isGatewayBot(endpoint)) throw new Error("群管仅支持 connection: gateway");
    return endpoint.banMember(sceneId, userId, reason);
  }

  async unbanMember(endpointId: string, sceneId: string, userId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    if (!isGatewayBot(endpoint)) throw new Error("群管仅支持 connection: gateway");
    return endpoint.unbanMember(sceneId, userId);
  }

  async muteMember(endpointId: string, sceneId: string, userId: string, duration = 600) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    if (!isGatewayBot(endpoint)) throw new Error("群管仅支持 connection: gateway");
    return endpoint.timeoutMember(sceneId, userId, duration);
  }

  async setMemberNickname(endpointId: string, sceneId: string, userId: string, nickname: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    if (!isGatewayBot(endpoint)) throw new Error("群管仅支持 connection: gateway");
    return endpoint.setNickname(sceneId, userId, nickname);
  }

  async listMembers(endpointId: string, sceneId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    if (!isGatewayBot(endpoint)) throw new Error("群管仅支持 connection: gateway");
    return endpoint.getMembers(sceneId);
  }

  async getGroupInfo(endpointId: string, sceneId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    if (!isGatewayBot(endpoint)) throw new Error("群管仅支持 connection: gateway");
    return endpoint.getGuildInfo(sceneId);
  }

  async start(): Promise<void> {
    this.#router = (this.plugin.inject as (key: string) => Router | undefined)("router");
    (this.plugin.useContext as (key: string, fn: (router: Router) => void) => void)(
      "router",
      (router: Router) => {
        this.#router = router;
      }
    );
    await super.start();
  }

}
