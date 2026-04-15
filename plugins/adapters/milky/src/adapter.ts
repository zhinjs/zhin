/**
 * Milky 适配器：单一适配器支持 WS 正向 / SSE / Webhook / 反向 WS，由 config.connection 区分
 */
import type { Router } from '@zhin.js/http';
import {
  Adapter,
  Plugin,
  type IGroupManagement,
} from 'zhin.js';
import { MilkyWsClient } from './bot-ws.js';
import { MilkySseClient } from './bot-sse.js';
import { MilkyWebhookBot } from './bot-webhook.js';
import { MilkyWssServer } from './bot-wss.js';
import type {
  MilkyBotConfig,
  MilkyWsConfig,
  MilkySseConfig,
  MilkyWebhookConfig,
  MilkyWssConfig,
} from './types.js';

export type MilkyBot = MilkyWsClient | MilkySseClient | MilkyWebhookBot | MilkyWssServer;

export class MilkyAdapter extends Adapter<MilkyBot> {
  #router?: Router;

  constructor(plugin: Plugin) {
    super(plugin, 'milky', []);
  }

  createBot(config: MilkyBotConfig): MilkyBot {
    switch (config.connection) {
      case 'ws':
        return new MilkyWsClient(this, config as MilkyWsConfig);
      case 'sse':
        return new MilkySseClient(this, config as MilkySseConfig);
      case 'webhook':
        if (!this.#router) throw new Error('Milky connection: webhook 需要 router，请安装并在配置中启用 @zhin.js/http');
        return new MilkyWebhookBot(this, this.#router, config as MilkyWebhookConfig);
      case 'wss':
        if (!this.#router) throw new Error('Milky connection: wss 需要 router，请安装并在配置中启用 @zhin.js/http');
        return new MilkyWssServer(this, this.#router, config as MilkyWssConfig);
      default:
        throw new Error(`Unknown Milky connection: ${(config as MilkyBotConfig).connection}`);
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
    return { members: Array.isArray(members) ? members : [], count: Array.isArray(members) ? members.length : 0 };
  }

  async getGroupInfo(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.getGroupInfo(Number(sceneId));
  }

  async start(): Promise<void> {
    // 同步获取已就绪的 router，或通过 useContext 在 router 挂载后赋值
    this.#router = (this.plugin.inject as (key: string) => Router | undefined)('router');
    (this.plugin.useContext as (key: string, fn: (router: Router) => void) => void)('router', (router: Router) => {
      this.#router = router;
    });
    await super.start();
    this.plugin.logger.info('Milky 适配器已启动');
  }
}
