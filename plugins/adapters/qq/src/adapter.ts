/**
 * QQ 官方适配器
 */
import {
  Adapter,
  Plugin,
} from "zhin.js";
import type { Router } from "@zhin.js/host-router";
import { QQEndpoint } from "./endpoint.js";
import type { QQEndpointConfig, ReceiverMode } from "./types.js";

export class QQAdapter extends Adapter<QQEndpoint<ReceiverMode>> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;

  #router?: Router;

  constructor(plugin: Plugin, router?: Router) {
    super(plugin, "qq", []);
    this.#router = router;
  }

  getRouter(): Router | undefined {
    return this.#router;
  }

  createEndpoint(config: QQEndpointConfig<ReceiverMode>): QQEndpoint<ReceiverMode> {
    return new QQEndpoint(this, config);
  }

  // ── IGroupManagement 标准群管方法 ──────────────────────────────────

  async kickMember(endpointId: string, sceneId: string, userId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.removeGuildMember(sceneId, userId, false);
  }

  async muteMember(endpointId: string, sceneId: string, userId: string, duration = 600) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.muteMembers(sceneId, [userId], duration);
  }

  async muteAll(endpointId: string, sceneId: string, enable = true) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.muteAll(sceneId, enable ? 600 : 0);
  }

  async listMembers(endpointId: string, sceneId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.getGuildMembers(sceneId);
  }

  async getGroupInfo(endpointId: string, sceneId: string) {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint.getGuildInfo(sceneId);
  }

  // ── 生命周期 ───────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (!this.#router) {
      this.#router = (this.plugin.inject as (key: string) => Router | undefined)("router");
    }
    (this.plugin.useContext as (key: string, fn: (router: Router) => void) => void)(
      "router",
      (router) => {
        this.#router = router;
      },
    );
    await super.start();
  }

}
