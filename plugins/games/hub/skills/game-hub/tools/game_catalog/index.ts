import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';
import { commandFeatureId, isCommandIndex } from 'zhin.js/command';
import type { GameCommandFormatter } from '@zhin.js/game-kit';
import type { Locale } from 'zhin.js/i18n';
import {
  resolveGameIndex,
  toGameCatalogEntry,
  type GameCatalogEntry,
} from '../../../../src/catalog.js';

const inputSchema = z.object({
  game: z.string().optional().describe('Optional game name or id to filter'),
});

export default defineAgentTool<{ game?: string }, { count: number; games: GameCatalogEntry[] }>({
  description: '查询游戏大厅中已注册的小游戏目录（名称、别名、人数范围、简介与开局指令；开局指令不含指令前缀，本会话配置了指令前缀时发送前要加上）',
  inputSchema,
  readOnly: true,
  requiresApproval: 'never',
  tags: ['game', 'entertainment'],
  keywords: ['游戏', '小游戏', '大厅', 'games', 'game-hub'],
  execute({ game }, context) {
    const index = resolveGameIndex(context);
    // The start command comes from the command index, as the `games` command writes it. A tool
    // turn has no command prefix of its own, so it is written without one (#1250 第 82 批).
    const formatCommand = unprefixedCommandFormatter(context);
    const allGames = index
      ? index.list().map(entry => toGameCatalogEntry(entry, { index, formatCommand, locale: context.locale }))
      : [];
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

function unprefixedCommandFormatter(context: Readonly<{ project?: unknown; locale?: Locale }>): GameCommandFormatter | undefined {
  if (typeof context.project !== 'function') return undefined;
  let commands: unknown;
  try {
    commands = (context.project as (feature: unknown) => unknown)(commandFeatureId);
  } catch {
    return undefined;
  }
  if (!isCommandIndex(commands)) return undefined;
  return (localPath, owner) => owner
    ? commands.formatCommand(owner, localPath, '', context.locale)
    : undefined;
}
