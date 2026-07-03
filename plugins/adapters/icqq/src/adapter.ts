/**
 * ICQQ 适配器 — 通过 @icqqjs/cli 守护进程 IPC 管理 Endpoint 实例
 */
import { formatCompact, Adapter, Plugin, OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL, ONEBOT_KEYBOARD_AI_OUTBOUND_EXTENSION } from 'zhin.js';
import { IcqqEndpoint } from "./endpoint.js";
import type { IcqqEndpointConfig, IpcMemberInfo } from "./types.js";
import { Actions } from "./protocol.js";

export class IcqqAdapter extends Adapter<IcqqEndpoint> {
  static override readonly capabilities = ['inbound', 'outbound'] as const;
  static override outboundRichSegmentPolicy = OUTBOUND_RICH_SEGMENT_POLICY_IM_FULL;
  static override interactivePolicy = 'text' as const;
  static override aiOutboundCapabilities = {
    mentions: true,
    richSegments: ['qrcode', 'html', 'markdown', 'tts'],
    interactive: 'text' as const,
  };
  static override aiOutboundExtensions = [ONEBOT_KEYBOARD_AI_OUTBOUND_EXTENSION];

  constructor(plugin: Plugin) {
    super(plugin, "icqq", []);
  }

  getOutboundMediaCapabilities() {
    return {
      image: true,
      audio: true,
      video: true,
      file: true,
      maxAttachmentBytes: 20 * 1024 * 1024,
    };
  }

  createEndpoint(config: IcqqEndpointConfig): IcqqEndpoint {
    return new IcqqEndpoint(this, config);
  }

  async start(): Promise<void> {
    await super.start();
  }

  async stop(): Promise<void> {
    await super.stop();
    this.logger.debug(formatCompact({ stop: true }));
  }

  // ── ISceneManagement 标准群管方法（通过 IPC） ─────────────────────

  private getEndpoint(endpointId: string): IcqqEndpoint {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error(`Endpoint ${endpointId} 不存在`);
    return endpoint;
  }

  async removeMember(endpointId: string, sceneId: string, userId: string) {
    const endpoint = this.getEndpoint(endpointId);
    const resp = await endpoint.ipc.request(Actions.GROUP_KICK, {
      group_id: Number(sceneId),
      user_id: Number(userId),
      reject_add_request: false,
    });
    if (!resp.ok) throw new Error(resp.error ?? "踢人失败");
    return true;
  }

  async muteMember(
    endpointId: string,
    sceneId: string,
    userId: string,
    duration = 600,
  ) {
    const endpoint = this.getEndpoint(endpointId);
    const resp = await endpoint.ipc.request(Actions.GROUP_MUTE, {
      group_id: Number(sceneId),
      user_id: Number(userId),
      duration,
    });
    if (!resp.ok) throw new Error(resp.error ?? "禁言失败");
    return true;
  }

  async setSceneMuted(endpointId: string, sceneId: string, enable = true) {
    const endpoint = this.getEndpoint(endpointId);
    const resp = await endpoint.ipc.request(Actions.GROUP_MUTE_ALL, {
      group_id: Number(sceneId),
      enable,
    });
    if (!resp.ok) throw new Error(resp.error ?? "全员禁言失败");
    return true;
  }

  async setModerator(
    endpointId: string,
    sceneId: string,
    userId: string,
    enable = true,
  ) {
    const endpoint = this.getEndpoint(endpointId);
    const resp = await endpoint.ipc.request(Actions.SET_GROUP_ADMIN, {
      group_id: Number(sceneId),
      user_id: Number(userId),
      enable,
    });
    if (!resp.ok) throw new Error(resp.error ?? "设置管理员失败");
    return true;
  }

  async setMemberNickname(
    endpointId: string,
    sceneId: string,
    userId: string,
    nickname: string,
  ) {
    const endpoint = this.getEndpoint(endpointId);
    const resp = await endpoint.ipc.request(Actions.SET_GROUP_CARD, {
      group_id: Number(sceneId),
      user_id: Number(userId),
      card: nickname,
    });
    if (!resp.ok) throw new Error(resp.error ?? "设置群名片失败");
    return true;
  }

  async renameScene(endpointId: string, sceneId: string, name: string) {
    const endpoint = this.getEndpoint(endpointId);
    const resp = await endpoint.ipc.request(Actions.SET_GROUP_NAME, {
      group_id: Number(sceneId),
      name,
    });
    if (!resp.ok) throw new Error(resp.error ?? "设置群名失败");
    return true;
  }

  async listMembers(endpointId: string, sceneId: string) {
    const endpoint = this.getEndpoint(endpointId);
    const resp = await endpoint.ipc.request(Actions.LIST_GROUP_MEMBERS, {
      group_id: Number(sceneId),
    });
    if (!resp.ok) throw new Error(resp.error ?? "获取成员列表失败");
    const raw = resp.data as IpcMemberInfo[];
    const members = raw.map((m) => ({
      user_id: m.user_id,
      nickname: m.nickname,
      card: m.card,
      role: m.role,
      title: m.title,
    }));
    return { members, count: members.length };
  }

}
