import type { Message, Plugin } from 'zhin.js';
import { parseChoicePayload } from './choice-keyboard.js';
import {
  buildGameHubMenu,
  buildMainHubMenu,
  formatHubEmptyMessage,
  HUB_PREFIX,
  hubActionChoiceId,
  hubGameChoiceId,
  parseHubChoiceId,
} from './game-hub-menu.js';
import { getRegisteredGame, getRegisteredGames } from './game-hub-feature.js';
import {
  createHubScope,
  getHubContext,
  rememberHubMenu,
  type HubMenuChoice,
} from './game-hub-menu-context.js';

function mainMenuChoices(): HubMenuChoice[] {
  return getRegisteredGames().map((g) => ({
    id: hubGameChoiceId(g.id),
    label: `${g.icon} ${g.title}`,
  }));
}

function gameMenuChoices(gameId: string, channelType: string): HubMenuChoice[] {
  const game = getRegisteredGame(gameId);
  if (!game) return [];
  const isGroup = channelType !== 'private';
  const menus = game.menus.filter((m) => {
    if (m.groupOnly && !isGroup) return false;
    if (m.privateOnly && isGroup) return false;
    return true;
  });
  return [
    ...menus.map((m) => ({
      id: hubActionChoiceId(game.id, m.id),
      label: m.label,
    })),
    { id: 'back', label: '↩️ 返回大厅' },
  ];
}

export function openMainMenu(message: Message<any>): ReturnType<typeof buildMainHubMenu> | string {
  const games = getRegisteredGames();
  if (!games.length) {
    return formatHubEmptyMessage();
  }
  const scopeId = createHubScope(message);
  const choices = mainMenuChoices();
  rememberHubMenu(message, scopeId, choices);
  return buildMainHubMenu(scopeId, games, message.$channel.type);
}

export async function handleHubChoice(
  plugin: Plugin,
  message: Message<any>,
  scopeId: string,
  choiceId: string,
): Promise<boolean> {
  const ctx = getHubContext(scopeId);
  if (!ctx) {
    await message.$reply?.('菜单已过期，请重新发送「游戏」。');
    return true;
  }
  const ch = `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
  if (ctx.channelKey !== ch) {
    await message.$reply?.('请在本频道使用游戏大厅。');
    return true;
  }

  const parsed = parseHubChoiceId(choiceId);
  if (!parsed) return false;

  // 大厅导航（选游戏 / 返回）：同频道任何人都可点；具体开局由 runAction 用当前点击者 message
  if (parsed.kind === 'back') {
    const games = getRegisteredGames();
    const choices = mainMenuChoices();
    rememberHubMenu(message, scopeId, choices);
    await message.$reply?.(buildMainHubMenu(scopeId, games, message.$channel.type));
    return true;
  }

  if (parsed.kind === 'game') {
    const game = getRegisteredGame(parsed.gameId);
    if (!game) {
      await message.$reply?.('该游戏未安装。');
      return true;
    }
    const choices = gameMenuChoices(parsed.gameId, message.$channel.type);
    rememberHubMenu(message, scopeId, choices);
    await message.$reply?.(
      buildGameHubMenu(scopeId, game, message.$channel.type),
    );
    return true;
  }

  const game = getRegisteredGame(parsed.gameId);
  if (!game) {
    await message.$reply?.('该游戏未安装。');
    return true;
  }

  const result = await game.runAction(parsed.actionId, { plugin, message });
  if (typeof result === 'string') await message.$reply?.(result);
  return true;
}

export function parseHubPayload(payload: string): { scopeId: string; choiceId: string } | null {
  const parsed = parseChoicePayload(payload, HUB_PREFIX);
  if (!parsed) return null;
  return { scopeId: parsed.sessionId, choiceId: parsed.choiceId };
}
