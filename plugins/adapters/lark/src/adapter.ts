/**
 * 飞书/Lark 适配器
 */
import {
  Adapter,
  Plugin,
} from "zhin.js";
import { LarkBot } from "./bot.js";
import type { LarkBotConfig } from "./types.js";

export class LarkAdapter extends Adapter<LarkBot> {
    #router: any;

    constructor(plugin: Plugin, router: any) {
        super(plugin, 'lark', []);
        this.#router = router;
    }

    createBot(config: LarkBotConfig): LarkBot {
        return new LarkBot(this, this.#router, config);
    }

    // ── IGroupManagement 标准群管方法 ──────────────────────────────────

    async kickMember(botId: string, sceneId: string, userId: string) {
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        return bot.removeChatMembers(sceneId, [userId]);
    }

    async listMembers(botId: string, sceneId: string) {
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        return bot.getChatMembers(sceneId);
    }

    async getGroupInfo(botId: string, sceneId: string) {
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        return bot.getChatInfo(sceneId);
    }

    async setGroupName(botId: string, sceneId: string, name: string) {
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        return bot.updateChatInfo(sceneId, { name });
    }

    // ── 生命周期 ───────────────────────────────────────────────────────

    async start(): Promise<void> {
        await super.start();
    }

}
