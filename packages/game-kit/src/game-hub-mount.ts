import {
  Message,
  MessageCommand,
  getActionFromMessage,
  resolvePayloadFromText,
  type Plugin,
} from '@zhin.js/core';
import { buildChoiceFallbackMap, parseChoicePayload } from './choice-keyboard.js';
import {
  formatHubEmptyMessage,
  buildBotHelpReply,
  buildHubHelpReply,
  HUB_PREFIX,
} from './game-hub-menu.js';
import { getLastHubMenu } from './game-hub-menu-context.js';
import { handleHubChoice, openMainMenu, parseHubPayload } from './game-hub-flow.js';
import { getRegisteredGames } from './game-hub-feature.js';
import { mountGameRecordCommands } from './game-records.js';
import { mountFirstAtHintMiddleware } from './game-onboarding.js';
import { filterHelpCommands, type CommandHelpSource } from './command-help.js';

function resolveRegisteredCommands(root: Plugin): MessageCommand[] {
  const commandService = root.inject('command') as { items?: MessageCommand[] } | undefined;
  return commandService?.items ?? [];
}

async function resolveHelpCommands(root: Plugin, message: Message<any>): Promise<CommandHelpSource[]> {
  return filterHelpCommands(resolveRegisteredCommands(root), message, root);
}

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
      new MessageCommand('/游戏')
        .desc('游戏大厅：选择游戏并开始')
        .action(openHandler),
    ),
    root.addCommand(
      new MessageCommand('/game')
        .desc('Game lobby (English alias)')
        .action(openHandler),
    ),
    root.addCommand(
      new MessageCommand('游戏')
        .desc('游戏大厅（无斜杠兼容）')
        .action(openHandler),
    ),
    root.addCommand(
      new MessageCommand('game')
        .desc('Game lobby (legacy alias)')
        .action(openHandler),
    ),
  );

  disposers.push(
    root.addCommand(
      new MessageCommand('/游戏 帮助')
        .desc('游戏大厅帮助')
        .action(async (message) =>
          buildHubHelpReply(getRegisteredGames(), await resolveHelpCommands(root, message)),
        ),
    ),
    root.addCommand(
      new MessageCommand('/帮助')
        .desc('机器人帮助：游戏列表与 QQ 群用法')
        .action(async (message) =>
          buildBotHelpReply(getRegisteredGames(), {
            channelType: message.$channel.type,
            commands: await resolveHelpCommands(root, message),
          }),
        ),
    ),
    root.addCommand(
      new MessageCommand('/help')
        .desc('Bot help (English alias)')
        .action(async (message) =>
          buildBotHelpReply(getRegisteredGames(), {
            channelType: message.$channel.type,
            commands: await resolveHelpCommands(root, message),
          }),
        ),
    ),
    root.addCommand(
      new MessageCommand('帮助')
        .desc('帮助（无斜杠兼容）')
        .action(async (message) =>
          buildBotHelpReply(getRegisteredGames(), {
            channelType: message.$channel.type,
            commands: await resolveHelpCommands(root, message),
          }),
        ),
    ),
  );

  disposers.push(mountGameRecordCommands(root));
  disposers.push(mountFirstAtHintMiddleware(root));

  root.registerInteractiveHandler(`${HUB_PREFIX}:`, (message) =>
    handleHubInteractive(root, message),
  );

  disposers.push(
    root.addMiddleware(async (message, next) => {
      const action = getActionFromMessage(message);
      if (action?.payload.startsWith(`${HUB_PREFIX}:`)) return next();

      const raw = message.$raw?.trim() ?? '';

      // QQ 指令预填等：payload 自包含 hub:scope:choice，不依赖 opener 的菜单缓存
      const directPayload = resolvePayloadFromText(raw);
      if (directPayload?.startsWith(`${HUB_PREFIX}:`)) {
        const direct = parseChoicePayload(directPayload, HUB_PREFIX);
        if (direct) {
          await handleHubChoice(root, message, direct.sessionId, direct.choiceId);
          return;
        }
      }

      const last = getLastHubMenu(message);
      if (!last) return next();

      const map = buildChoiceFallbackMap(HUB_PREFIX, last.scopeId, last.choices);
      const payload = resolvePayloadFromText(raw, map);
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
