/**
 * 钉钉适配器
 */
import {
  Adapter,
  Plugin,
} from "zhin.js";
import { DingTalkBot } from "./bot.js";
import type { DingTalkBotConfig } from "./types.js";

export class DingTalkAdapter extends Adapter<DingTalkBot> {
  #router: any;

  constructor(plugin: Plugin, router: any) {
    super(plugin, "dingtalk", []);
    this.#router = router;
  }

  createBot(config: DingTalkBotConfig): DingTalkBot {
    return new DingTalkBot(this, this.#router, config);
  }

  async kickMember(botId: string, sceneId: string, userId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.updateChat(sceneId, { del_useridlist: [userId] });
  }

  async setGroupName(botId: string, sceneId: string, name: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.updateChat(sceneId, { name });
  }

  async getGroupInfo(botId: string, sceneId: string) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot.getChatInfo(sceneId);
  }

  async start(): Promise<void> {
    await super.start();
  }
}
