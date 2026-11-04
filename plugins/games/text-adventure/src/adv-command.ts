import { createMessages, resolveLocale } from 'zhin.js/i18n';
import { formatGameHelp, gameCommandHint, gameCommandFeedback, channelKey, type GamePlayer, type GameReply } from '@zhin.js/game-kit';
import {
  continueAdventure,
  sessionSummary,
  startAdventure,
} from './game-flow.js';
import { formatAchievements, formatMapProgress, formatProgressCompact } from './profile-format.js';
import type { GameServices } from './session-service.js';


const messages = createMessages({
  map: { 'zh-CN': '全图探索进度', en: 'Exploration map' },
  achievements: { 'zh-CN': '成就列表', en: 'Achievements' },
  choices: { 'zh-CN': '推进方式：点击选项按钮，或回复数字（1、2…）', en: 'Choose an option button, or reply with its number (1, 2, …).' },
  channel: { 'zh-CN': '— 当前频道 —', en: '— Current channel —' },
  noGame: { 'zh-CN': '你没有进行中的冒险。', en: 'You have no active adventure.' },
  quit: { 'zh-CN': '你已放弃冒险。', en: 'You have abandoned the adventure.' },
});

export function getAdvHelp(message: Pick<GamePlayer, 'locale' | 'formatCommand'>): string {
  const locale = resolveLocale(message.locale);
  const lines = [formatGameHelp({ presentation: message, title: { 'zh-CN': '秘境探险 · 文字冒险', en: 'Hidden Ruins · Text Adventure' }, commandPath: 'adv', actions: ['start', 'continue', 'quit'] })];
  const command = message.formatCommand?.('adv');
  if (command !== undefined) {
    lines.push(`${command} map — ${messages(locale, 'map')}`);
    lines.push(`${command} achievements — ${messages(locale, 'achievements')}`);
  }
  lines.push('', messages(locale, 'choices'));
  return lines.join('\n');
}
export const ADV_HELP = getAdvHelp({});

export async function runAdvCommand(
  services: GameServices,
  message: GamePlayer,
  action: string,
): Promise<GameReply> {
  return services.sessions.runInScope({ scope: channelKey(message), run: async () => {
    const locale = resolveLocale(message.locale);
    const ch = channelKey(message);
    const userId = message.sender.id;
    const userName = message.sender.name?.trim() || userId;

    if (!action || action === 'help') {
      const active = await services.sessions.getActiveByChannel(ch);
      const profile = await services.profiles.getOrCreate(userId, userName);
      const lines = [getAdvHelp(message), '', formatProgressCompact(profile), ''];
      if (active) {
        lines.push(messages(locale, 'channel'));
        lines.push(sessionSummary(active));
      } else {
        lines.push(messages(locale, 'noGame') + gameCommandHint(message, 'adv'));
      }
      return lines.join('\n');
    }

    if (action === 'start') {
      return (await startAdventure(services, message)) ?? '';
    }

    if (action === 'continue') {
      return continueAdventure(services, message);
    }

    if (action === 'map') {
      const profile = await services.profiles.getOrCreate(userId, userName);
      return formatMapProgress(profile, locale);
    }

    if (action === 'achievements' || action === 'achievement') {
      const profile = await services.profiles.getOrCreate(userId, userName);
      return formatAchievements(profile, false, locale);
    }

    if (action === 'quit') {
      const row = await services.sessions.getActiveForUser(ch, userId);
      if (!row) return messages(locale, 'noGame');
      await services.sessions.updateSession(row.id, { status: 'aborted' });
      return messages(resolveLocale(row.locale), 'quit');
    }

    return `${gameCommandFeedback(message, 'unknown', action)}\n\n${getAdvHelp(message)}`;
  } });
}
