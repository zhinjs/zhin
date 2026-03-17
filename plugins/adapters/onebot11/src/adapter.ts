/**
 * OneBot11 适配器：单一适配器支持正向 WS / 反向 WS，由 config.connection 区分
 */
import type { Router } from '@zhin.js/http';
import {
  Adapter,
  Plugin,
  createGroupManagementTools,
  GROUP_MANAGEMENT_SKILL_KEYWORDS,
  GROUP_MANAGEMENT_SKILL_TAGS,
  type IGroupManagement,
} from 'zhin.js';
import { OneBot11WsClient } from './bot-ws-client.js';
import { OneBot11WsServer } from './bot-ws-server.js';
import type {
  OneBot11WsClientConfig,
  OneBot11WsServerConfig,
  OneBot11BotConfig,
} from './types.js';

export type OneBot11Bot = OneBot11WsClient | OneBot11WsServer;

export class OneBot11Adapter extends Adapter<OneBot11Bot> {
  #router?: Router;

  constructor(plugin: Plugin) {
    super(plugin, 'onebot11', []);
  }

  createBot(config: OneBot11BotConfig): OneBot11Bot {
    const connection = config.connection ?? ((config as { type?: string }).type === 'ws_reverse' ? 'wss' : 'ws');
    switch (connection) {
      case 'ws':
        return new OneBot11WsClient(this, config as OneBot11WsClientConfig);
      case 'wss':
        if (!this.#router) {
          throw new Error('OneBot11 connection: wss 需要 router，请安装并在配置中启用 @zhin.js/http');
        }
        return new OneBot11WsServer(this, this.#router, config as OneBot11WsServerConfig);
      default:
        throw new Error(`Unknown OneBot11 connection: ${connection}`);
    }
  }

  async kickMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.kickMember(Number(sceneId), Number(userId), false);
  }

  async muteMember(botId: string, sceneId: string, userId: string, duration = 600) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.muteMember(Number(sceneId), Number(userId), duration);
  }

  async muteAll(botId: string, sceneId: string, enable = true) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.muteAll(Number(sceneId), enable);
  }

  async setAdmin(botId: string, sceneId: string, userId: string, enable = true) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.setAdmin(Number(sceneId), Number(userId), enable);
  }

  async setMemberNickname(botId: string, sceneId: string, userId: string, nickname: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.setCard(Number(sceneId), Number(userId), nickname);
  }

  async setGroupName(botId: string, sceneId: string, name: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.setGroupName(Number(sceneId), name);
  }

  async listMembers(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    const members = await bot.getMemberList(Number(sceneId));
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

  async getGroupInfo(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.getGroupInfo(Number(sceneId));
  }

  async start(): Promise<void> {
    this.#router = (this.plugin.inject as (key: string) => Router | undefined)('router');
    (this.plugin.useContext as (key: string, fn: (router: Router) => void) => void)('router', (router: Router) => {
      this.#router = router;
    });
    this.registerOneBot11PlatformTools();
    const groupTools = createGroupManagementTools(this as unknown as IGroupManagement, this.name);
    groupTools.forEach((t) => this.addTool(t));
    this.declareSkill({
      description:
        'OneBot11 协议群管理：踢人、禁言、封禁、设管理员、改群名、查成员等。仅有昵称时请先 list_members 获取 user_id 再执行操作。',
      keywords: GROUP_MANAGEMENT_SKILL_KEYWORDS,
      tags: GROUP_MANAGEMENT_SKILL_TAGS,
    });
    await super.start();
  }

  private registerOneBot11PlatformTools(): void {
    this.addTool({
      name: 'onebot11_set_title',
      description: '设置群成员的专属头衔（需要群主权限）',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          group_id: { type: 'number', description: '群号' },
          user_id: { type: 'number', description: '成员 QQ 号' },
          title: { type: 'string', description: '头衔名称' },
        },
        required: ['bot', 'group_id', 'user_id', 'title'],
      },
      platforms: ['onebot11'],
      scopes: ['group'],
      permissionLevel: 'group_owner',
      execute: async (args) => {
        const { bot: botId, group_id, user_id, title } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.setTitle(group_id, user_id, title);
        return { success, message: success ? `已将 ${user_id} 的头衔设为 "${title}"` : '操作失败' };
      },
    });
  }
}
