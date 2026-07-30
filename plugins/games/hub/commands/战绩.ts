import { defineCommand } from '@zhin.js/command';
import {
  channelKey,
  getUserGameStats,
  getRuntimeGame,
  messageFromCommandInput,
} from '@zhin.js/game-kit';

function formatStats(stats: Awaited<ReturnType<typeof getUserGameStats>>): string {
  if (!stats.length) return '暂无战绩记录，快去 `/游戏` 开一局吧！';
  const lines = stats.map((s) => {
    const g = getRuntimeGame(s.gameId);
    const title = g ? `${g.icon} ${g.title}` : s.gameId;
    return `• ${title}：${s.wins} 胜 ${s.losses} 负${s.draws ? ` ${s.draws} 平` : ''}（${s.games} 局，得分 ${s.totalScore}）`;
  });
  return ['📊 **你的战绩**', '', ...lines].join('\n');
}

export default defineCommand({
  description: '查看本人在本群的游戏战绩',
  async execute({ input }) {
    const message = messageFromCommandInput(input);
    const stats = await getUserGameStats(message.$sender.id, channelKey(message));
    return formatStats(stats);
  },
});
