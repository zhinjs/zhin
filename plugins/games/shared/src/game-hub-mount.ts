import {
  Message,
  MessageCommand,
  getActionFromMessage,
  type Plugin,
} from 'zhin.js';
import { buildChoiceFallbackMap, parseChoicePayload } from './choice-keyboard.js';
import {
  formatHubEmptyMessage,
  formatHubHelp,
  HUB_PREFIX,
} from './game-hub-menu.js';
import { getLastHubMenu } from './game-hub-menu-context.js';
import { handleHubChoice, openMainMenu, parseHubPayload } from './game-hub-flow.js';
import { getRegisteredGames } from './game-hub-feature.js';

/**
 * 在 root 上挂载「游戏 / game」大厅命令，返回 dispose 列表。
 */
export function mountGameHubUi(root: Plugin): (() => void)[] {
  const disposers: (() => void)[] = [];

  const openHandler = async (message: Message<any>) => {
    const games = getRegisteredGames();
    if (!games.length) {
      return formatHubEmptyMessage();
    }
    const menu = openMainMenu(message);
    if (typeof menu === 'string') return menu;
    await message.$reply?.(menu);
    return undefined;
  };

  disposers.push(
    root.addCommand(
      new MessageCommand('游戏')
        .desc('游戏大厅：选择游戏并开始')
        .action(openHandler),
    ),
  );

  disposers.push(
    root.addCommand(
      new MessageCommand('game')
        .desc('Game lobby (English alias)')
        .action(openHandler),
    ),
  );

  disposers.push(
    root.addCommand(
      new MessageCommand('游戏 帮助')
        .desc('游戏大厅帮助')
        .action(async () => formatHubHelp(getRegisteredGames())),
    ),
  );

  root.registerInteractiveHandler(`${HUB_PREFIX}:`, (message) =>
    handleHubInteractive(root, message),
  );

  disposers.push(
    root.addMiddleware(async (message, next) => {
      const action = getActionFromMessage(message);
      if (action?.payload.startsWith(`${HUB_PREFIX}:`)) return next();

      const raw = message.$raw?.trim() ?? '';
      const n = /^(\d+)$/.exec(raw);
      if (!n) return next();

      const last = getLastHubMenu(message);
      if (!last) return next();

      const map = buildChoiceFallbackMap(HUB_PREFIX, last.scopeId, last.choices);
      const payload = map[n[1]!];
      const parsed = payload ? parseChoicePayload(payload, HUB_PREFIX) : null;
      if (!parsed || parsed.sessionId !== last.scopeId) return next();

      await handleHubChoice(root, message, parsed.sessionId, parsed.choiceId);
    }),
  );

  return disposers;
}

async function handleHubInteractive(root: Plugin, message: Message<any>): Promise<boolean> {
  const action = getActionFromMessage(message);
  if (!action) return false;

  const fromPayload = parseHubPayload(action.payload);
  if (!fromPayload) return false;

  return handleHubChoice(root, message, fromPayload.scopeId, fromPayload.choiceId);
}

let hubUiMounted = false;

export function isGameHubMounted(): boolean {
  return hubUiMounted;
}

export function markGameHubUiMounted(): void {
  hubUiMounted = true;
}

export function resetGameHubMountForTests(): void {
  hubUiMounted = false;
}
