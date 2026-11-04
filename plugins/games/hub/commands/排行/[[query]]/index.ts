import { createMessages, type Locale } from 'zhin.js/i18n';
import { defineCommand } from 'zhin.js/command';
import {
  channelKey,
  gameFeatureId,
  gamePlayerFromInput,
  type LeaderboardEntry,
  type GameIndex,
} from '@zhin.js/game-kit';

function formatLeaderboard(index: GameIndex, gameId: string, entries: LeaderboardEntry[], locale: Locale, menu?: string): string {
  const g = index.get(gameId);
  const title = g ? `${g.icon} ${g.titleI18n?.[locale] ?? g.title}` : gameId;
  if (!entries.length) {
    return messages(locale, 'empty', { title }) + (menu ? messages(locale, 'menu', { command: menu }) : '');
  }
  const lines = entries.map((e, i) =>
    messages(locale, 'entry', { rank: i + 1, name: e.userName, wins: e.wins, games: e.games, score: e.totalScore }),
  );
  return [messages(locale, 'title', { title }), '', ...lines].join('\n');
}

export default defineCommand({
  alias: ['game-ranking'],
  preferredAliasI18n: { en: 'game-ranking' },
  description: '查看本群某游戏排行榜', descriptionI18n: { en: "View this group's leaderboard for a game" },
  params: { query: { type: 'string', default: '' } },
  async execute({ input, params, project, locale, formatCommand }) {
    const index = project<GameIndex>(gameFeatureId);
    const query = String(params.query ?? '').trim();
    const games = index.list();
    if (!games.length) return messages(locale, 'noGames');
    const firstGame = games[0];
    if (!firstGame) return messages(locale, 'noGames');
    let gameId = firstGame.id;
    if (query) {
      const hit = games.find(
        (g) => g.id === query
          || (g.titleI18n?.[locale] ?? g.title).includes(query)
          || g.commandPrefix.includes(query)
          || g.aliases?.some((a) => a.includes(query)),
      );
      if (!hit) {
        const names = games.map((g) => g.titleI18n?.[locale] ?? g.title).join(locale === 'en' ? ', ' : '、');
        return messages(locale, 'missing', { query, names });
      }
      gameId = hit.id;
    }
    const message = gamePlayerFromInput(input, { locale, formatCommand });
    const board = await index.getLeaderboard(gameId, channelKey(message));
    return formatLeaderboard(index, gameId, board, locale, formatCommand?.('games'));
  },
});

const messages = createMessages({
  empty: { 'zh-CN': '{title} 在本群暂无排行。', en: 'No {title} leaderboard in this group yet.' },
  menu: { 'zh-CN': '发送 `{command}` 查看游戏。', en: ' Send `{command}` to browse games.' },
  entry: { 'zh-CN': '{rank}. {name} — {wins} 胜 / {games} 局（得分 {score}）', en: '{rank}. {name} — {wins} wins / {games} games (score {score})' },
  title: { 'zh-CN': '🏆 **{title} 本群排行**', en: '🏆 **{title} group leaderboard**' },
  noGames: { 'zh-CN': '暂无已注册游戏。', en: 'No games are registered.' },
  missing: { 'zh-CN': '未找到游戏「{query}」。可选：{names}', en: 'Game “{query}” was not found. Available: {names}' },
});
