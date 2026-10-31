import { createMessages, type Locale } from 'zhin.js/i18n';
import { defineCommand } from 'zhin.js/command';
import {
  channelKey,
  gameFeatureId,
  gamePlayerFromInput,
  type GameIndex,
  type UserGameStats,
} from '@zhin.js/game-kit';

function formatStats(index: GameIndex, stats: UserGameStats[], locale: Locale, menu?: string): string {
  if (!stats.length) return messages(locale, 'empty') + (menu ? messages(locale, 'menu', { command: menu }) : '');
  const lines = stats.map((s) => {
    const g = index.get(s.gameId);
    const title = g ? `${g.icon} ${g.titleI18n?.[locale] ?? g.title}` : s.gameId;
    return messages(locale, 'record', { title, wins: s.wins, losses: s.losses, draws: s.draws ? messages(locale, 'draws', { count: s.draws }) : '', games: s.games, score: s.totalScore });
  });
  return [messages(locale, 'title'), '', ...lines].join('\n');
}

export default defineCommand({
  alias: ['game-stats'],
  preferredAliasI18n: { en: 'game-stats' },
  description: '查看本人在本群的游戏战绩', descriptionI18n: { en: "View your game statistics in this group" },
  async execute({ input, project, locale, formatCommand }) {
    const index = project<GameIndex>(gameFeatureId);
    const message = gamePlayerFromInput(input, { locale, formatCommand });
    const stats = await index.getUserStats(message.sender.id, channelKey(message));
    return formatStats(index, stats, locale, formatCommand?.('games'));
  },
});

const messages = createMessages({
  empty: { 'zh-CN': '暂无战绩记录。', en: 'No game statistics yet.' },
  menu: { 'zh-CN': '发送 `{command}` 查看游戏。', en: ' Send `{command}` to browse games.' },
  title: { 'zh-CN': '📊 **你的战绩**', en: '📊 **Your statistics**' },
  draws: { 'zh-CN': ' {count} 平', en: ' {count} draws' },
  record: { 'zh-CN': '• {title}：{wins} 胜 {losses} 负{draws}（{games} 局，得分 {score}）', en: '• {title}: {wins} wins, {losses} losses{draws} ({games} games, score {score})' },
});
