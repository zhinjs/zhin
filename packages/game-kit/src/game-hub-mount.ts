import {
  Message,
  MessageCommand,
  getActionFromMessage,
  type Plugin,
} from '@zhin.js/core';
import {
  formatHubEmptyMessage,
  buildBotHelpReply,
  buildHubHelpReply,
  HUB_PREFIX,
} from './game-hub-menu.js';
import { handleHubChoice, openMainMenu, parseHubPayload } from './game-hub-flow.js';
import { getRegisteredGames } from './game-hub-feature.js';
import { mountGameRecordCommands } from './game-records.js';
import { mountFirstAtHintMiddleware } from './game-onboarding.js';
import { filterHelpCommands, type CommandHelpSource } from './command-help.js';

function resolveRegisteredCommands(root: Plugin): MessageCommand[] {
  const commandService = root.inject('command') as { items?: MessageCommand[] } | undefined;
  return commandService?.items ?? [];
}

async function resolveHelpCommands(root: Plugin, message: Message): Promise<CommandHelpSource[]> {
  return filterHelpCommands(resolveRegisteredCommands(root), message, root);
}

/**
 * 在 root 上挂载「游戏 / game」大厅命令，返回 dispose 列表。
 *
 * @deprecated 仅 classic `GameHubFeature` / `bootstrapNode` 路径。
 * Plugin Runtime 请用 `@zhin.js/plugin-game-hub` 的 `commands/games/`（defineCommand）。
 * 勿在新代码调用；随 classic Feature 退役。
 */
export function mountGameHubUi(root: Plugin): (() => void)[] {
  const disposers: (() => void)[] = [];

  const openHandler = async (message: Message) => {
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

  // interactive 回跳由框架中央执行（`registerInteractiveHandler` 安装的根
  // 中间件）：action 段、数字 fallback（中央存储的菜单映射）与 QQ 指令预填
  // 直出 payload 都路由到下面的 hub handler，不再自行解析文本。
  root.registerInteractiveHandler(`${HUB_PREFIX}:`, (message) =>
    handleHubInteractive(root, message),
  );

  return disposers;
}

async function handleHubInteractive(root: Plugin, message: Message): Promise<boolean> {
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
