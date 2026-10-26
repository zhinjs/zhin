import { commandFeatureId, defineCommand } from '@zhin.js/command';
import { createMessages, isLocale, PluginStateStore, rootPluginId, userLocalePreferencesToken,
  type DatabaseHost, type UserLocalePreferences } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';

const messages = createMessages({
  usage: { 'zh-CN': '用法：{chinese} 或 {english}', en: 'Usage: {chinese} or {english}' },
  unavailable: { 'zh-CN': '个人语言设置需要 SQLite、MySQL 或 PostgreSQL 持久存储；当前仍使用项目语言。', en: 'Personal language settings require SQLite, MySQL, or PostgreSQL storage. The project language is still in use.' },
  identity: { 'zh-CN': '请在有真实发送者身份的聊天中设置个人语言。', en: 'Set your language from a chat with a sender identity.' },
  commandUnavailable: { 'zh-CN': '当前环境无法确定语言指令的调用方式。', en: 'The language command is unavailable in this command environment.' },
  saved: { 'zh-CN': '个人语言已设置为简体中文；新操作生效，进行中的交互保持原语言。', en: 'Your language is now English. New operations use it; ongoing interactions keep their original language.' },
  failed: { 'zh-CN': '无法确认个人语言已保存，请稍后重新设置。', en: 'The language setting could not be confirmed. Please try setting it again later.' },
});

/** Uses the existing SQL state port; no file or memory persistence fallback. */
export function installLocaleHost(database: DatabaseHost): RootResourceInstaller {
  return (context) => {
    let preferences: UserLocalePreferences | undefined;
    if (database.state && ['sqlite', 'mysql', 'pg'].includes(database.dialect)) {
      const state = new PluginStateStore(rootPluginId(), database.state, undefined, context.admission);
      preferences = Object.freeze({
        async get(endpoint, senderId) {
          const value = await state.forUser(endpoint, senderId).get('locale');
          return isLocale(value) ? value : undefined;
        },
        async set(endpoint, senderId, locale) {
          if (!isLocale(locale)) throw new TypeError('Unsupported locale');
          await state.forUser(endpoint, senderId).set('locale', locale);
        },
      } satisfies UserLocalePreferences);
      context.resources.provide(userLocalePreferencesToken, preferences);
    }
    if (!context.hasFeature?.(commandFeatureId)) return;
    context.addFeature(commandFeatureId, 'language', defineCommand({
      description: '设置个人语言',
      descriptionI18n: { en: 'Set your language' },
      execute: async (command) => {
        const requested = command.args.join(' ').trim();
        const input = command.input;
        if (!input?.sender?.id || !input.conversation) return messages(command.locale, 'identity');
        if (!isLocale(requested)) {
          const invocation = command.formatCommand('language');
          if (invocation === undefined) return messages(command.locale, 'commandUnavailable');
          return messages(command.locale, 'usage', {
            chinese: `${invocation} zh-CN`, english: `${invocation} en`,
          });
        }
        if (!preferences) return messages(command.locale, 'unavailable');
        try { await preferences.set(input.conversation.endpoint, input.sender.id, requested); }
        catch { return messages(command.locale, 'failed'); }
        return messages(requested, 'saved');
      },
    }));
  };
}
