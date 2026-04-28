/**
 * NapCat 适配器：支持正向 WS / 反向 WS / HTTP
 */
import type { Router } from '@zhin.js/http';
import { Adapter, Plugin } from 'zhin.js';
import { NapCatWsClient } from './bot-ws-client.js';
import { NapCatWsServer } from './bot-ws-server.js';
import { NapCatHttpBot } from './bot-http.js';
import type { NapCatBotConfig, NapCatWsClientConfig, NapCatWsServerConfig, NapCatHttpConfig } from './types.js';

export type NapCatBot = NapCatWsClient | NapCatWsServer | NapCatHttpBot;

export class NapCatAdapter extends Adapter<NapCatBot> {
  #router?: Router;

  constructor(plugin: Plugin) {
    super(plugin, 'napcat', []);
  }

  createBot(config: NapCatBotConfig): NapCatBot {
    const connection = config.connection ?? 'ws';
    switch (connection) {
      case 'ws':
        return new NapCatWsClient(this, config as NapCatWsClientConfig);
      case 'wss':
        if (!this.#router) throw new Error('NapCat connection: wss requires router. Enable @zhin.js/http first.');
        return new NapCatWsServer(this, this.#router, config as NapCatWsServerConfig);
      case 'http':
        if (!this.#router) throw new Error('NapCat connection: http requires router. Enable @zhin.js/http first.');
        return new NapCatHttpBot(this, this.#router, config as NapCatHttpConfig);
      default:
        throw new Error(`Unknown NapCat connection: ${connection}`);
    }
  }

  // ── 群管理接口（IGroupManagement 适配）──────────────────────────

  async kickMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} not found`);
    return bot.kickMember(Number(sceneId), Number(userId));
  }

  async muteMember(botId: string, sceneId: string, userId: string, duration = 600) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} not found`);
    return bot.muteMember(Number(sceneId), Number(userId), duration);
  }

  async muteAll(botId: string, sceneId: string, enable = true) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} not found`);
    return bot.muteAll(Number(sceneId), enable);
  }

  async setAdmin(botId: string, sceneId: string, userId: string, enable = true) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} not found`);
    return bot.setAdmin(Number(sceneId), Number(userId), enable);
  }

  async setMemberNickname(botId: string, sceneId: string, userId: string, nickname: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} not found`);
    return bot.setCard(Number(sceneId), Number(userId), nickname);
  }

  async setGroupName(botId: string, sceneId: string, name: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} not found`);
    return bot.setGroupName(Number(sceneId), name);
  }

  async listMembers(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} not found`);
    const members = await bot.getMemberList(Number(sceneId));
    return {
      members: members.map((m: any) => ({
        user_id: m.user_id, nickname: m.nickname, card: m.card, role: m.role, title: m.title,
      })),
      count: members.length,
    };
  }

  async getGroupInfo(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} not found`);
    return bot.getGroupInfo(Number(sceneId));
  }

  async start(): Promise<void> {
    this.#router = (this.plugin.inject as (key: string) => Router | undefined)('router');
    (this.plugin.useContext as (key: string, fn: (router: Router) => void) => void)('router', (router: Router) => {
      this.#router = router;
    });
    await super.start();
    this.plugin.logger.info('NapCat adapter started');
  }
}
