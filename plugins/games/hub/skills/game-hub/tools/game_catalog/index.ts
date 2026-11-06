import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import {
  resolveGameIndex,
  toGameCatalogEntry,
  type GameCatalogEntry,
} from '../../../../src/catalog.js';

const inputSchema = z.object({
  game: z.string().optional().describe('Optional game name or id to filter'),
});

export default defineAgentTool<{ game?: string }, { count: number; games: GameCatalogEntry[] }>({
  description: '查询游戏大厅中已注册的小游戏目录（名称、别名、人数范围、简介与开局指令）',
  inputSchema,
  readOnly: true,
  requiresApproval: 'never',
  tags: ['game', 'entertainment'],
  keywords: ['游戏', '小游戏', '大厅', 'games', 'game-hub'],
  execute({ game }, context) {
    const index = resolveGameIndex(context);
    const allGames = index ? index.list().map(toGameCatalogEntry) : [];
    const query = game?.trim().toLowerCase();
    const games = query
      ? allGames.filter((entry) =>
        entry.id.toLowerCase().includes(query)
        || entry.name.toLowerCase().includes(query)
        || entry.aliases.some((alias) => alias.toLowerCase().includes(query)))
      : allGames;
    return {
      count: games.length,
      games,
    };
  },
});
