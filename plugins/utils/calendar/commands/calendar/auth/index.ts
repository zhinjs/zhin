import { messages as t } from '../../../src/i18n.js';
import { defineCommand } from "zhin.js/command";
import { createDeliveryTarget } from "zhin.js";
import { parseOAuthProvider } from "../../../src/chat-auth.js";
import { calendarRuntimeToken } from "../../../src/runtime.js";

export default defineCommand({
  description: "通过聊天完成 Google / Outlook 日历 OAuth 授权（master 专用）", descriptionI18n: { en: "Authorize Google or Outlook Calendar through chat (bot master only)" },
  params: {
    provider: { type: "string", description: "google 或 microsoft（outlook）", descriptionI18n: { en: "google or microsoft (outlook)" } },
  },
  permit: ["role(master)"],
  async execute({ input, params, use, locale, formatCommand }) {
    const provider = parseOAuthProvider(params.provider);
    if (!provider) {
      return formatCommand('calendar auth') ? t(locale, 'usage', { command: formatCommand('calendar auth')! }) : t(locale, 'providerInput');
    }
    if (!input?.sender?.id) {
      return t(locale, 'chatRequired');
    }
    const requester = {
      sender_id: input.sender.id,
      target: createDeliveryTarget(input),
    };
    return use(calendarRuntimeToken).auth.startAuthorization(
      provider,
      requester,
      locale
    );
  },
});
