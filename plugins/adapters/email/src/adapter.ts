/**
 * Email 适配器
 */
import { Adapter, Plugin } from "zhin.js";
import { EmailBot } from "./bot.js";
import type { EmailBotConfig } from "./types.js";

export class EmailAdapter extends Adapter<EmailBot> {
    constructor(plugin: Plugin) {
        super(plugin, 'email', []);
    }

    createBot(config: EmailBotConfig): EmailBot {
        return new EmailBot(this, config);
    }
}
