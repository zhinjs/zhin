import { defineCommand } from '@zhin.js/command';
import {
  channelKey,
  getGameLeaderboard,
  getRuntimeGame,
  getRuntimeGames,
  messageFromCommandInput,
  type LeaderboardEntry,
} from '@zhin.js/game-kit';

function formatLeaderboard(gameId: string, entries: LeaderboardEntry[]): string {
  const g = getRuntimeGame(gameId);
  const title = g ? `${g.icon} ${g.title}` : gameId;
  if (!entries.length) {
    return `${title} 在本群暂无排行，发送 \`/游戏\` 开始第一局！`;
  }
  const lines = entries.map((e, i) =>
    `${i + 1}. ${e.userName} — ${e.wins} 胜 / ${e.games} 局（得分 ${e.totalScore}）`,
  );
  return [`🏆 **${title} 本群排行**`, '', ...lines].join('\n');
}

export default defineCommand({
  description: '查看本群某游戏排行榜',
  params: { query: { type: 'string', default: '' } },
  async execute({ input, params }) {
    const query = String(params.query ?? '').trim();
    const games = getRuntimeGames();
    if (!games.length) return '暂无已注册游戏。';
    const firstGame = games[0];
    if (!firstGame) return '暂无已注册游戏。';
    let gameId = firstGame.id;
    if (query) {
      const hit = games.find(
        (g) => g.id === query
          || g.title.includes(query)
          || g.commandPrefix.includes(query)
          || g.aliases?.some((a) => a.includes(query)),
      );
      if (!hit) {
        const names = games.map((g) => g.title).join('、');
        return `未找到游戏「${query}」。可选：${names}`;
      }
      gameId = hit.id;
    }
    const message = messageFromCommandInput(input);
    const board = await getGameLeaderboard(gameId, channelKey(message));
    return formatLeaderboard(gameId, board);
  },
});
