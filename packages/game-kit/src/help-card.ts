import {
  Card,
  CardCanvas,
  CardHeader,
  DEFAULT_CARD_THEME,
  h,
  KvRow,
  Section,
  TopicItem,
} from '@zhin.js/satori';
import type { RegisteredGame } from './game-hub-feature.js';
import { slashCommandPrefix } from './game-commands.js';
import {
  collectSupplementaryCommandHelp,
  formatHubOpenCommandLines,
  type CommandHelpSource,
} from './command-help.js';

export const HELP_CARD_CANVAS = DEFAULT_CARD_THEME.canvas;
export const HELP_CARD_WIDTH = 560;

function cardShell(inner: string): string {
  return h(CardCanvas, {
    width: HELP_CARD_WIDTH,
    backgroundColor: HELP_CARD_CANVAS,
    children: h(Card, { children: inner }),
  });
}

function gameTopicSummary(game: RegisteredGame): string {
  const quick = game.quickStart ?? '开始';
  const cmd = `${slashCommandPrefix(game.commandPrefix.replace(/^\//, ''))} ${quick}`;
  const alias = game.aliases?.length ? ` · ${game.aliases.join(' / ')}` : '';
  return `${cmd}${alias} — ${game.description}`;
}

function commandTopicSummary(cmd: CommandHelpSource): string {
  const [label = '', detail = ''] = cmd.helpInfo.desc;
  return detail || label || cmd.pattern;
}

export interface BotHelpCardInput {
  games: readonly RegisteredGame[];
  commands?: readonly CommandHelpSource[];
  channelType?: string;
}

export function buildBotHelpHtml(input: BotHelpCardInput): string {
  const { games, commands, channelType } = input;
  const hubLines = formatHubOpenCommandLines(commands);
  const other = commands?.length
    ? collectSupplementaryCommandHelp(commands, games)
    : [];

  const parts: string[] = [];

  parts.push(
    h(CardHeader, {
      title: '游戏大厅',
      subtitle: games.length
        ? `已注册 ${games.length} 款游戏 · 发送 /游戏 打开按钮大厅`
        : '暂无已注册游戏',
      badge: '🎮',
    }),
  );

  if (hubLines.length) {
    parts.push(
      h(Section, {
        title: '入口',
        children: hubLines.map((line) => {
          const sep = line.indexOf(' — ');
          const pattern = sep >= 0 ? line.slice(0, sep) : line;
          const desc = sep >= 0 ? line.slice(sep + 3) : '';
          return h(KvRow, { label: pattern, value: desc, labelWidth: 72 });
        }),
      }),
    );
  }

  if (games.length) {
    parts.push(
      h(Section, {
        title: '游戏列表',
        children: games.map((g, i) =>
          h(TopicItem, {
            index: i + 1,
            title: `${g.icon} ${g.title}`,
            summary: gameTopicSummary(g),
          }),
        ),
      }),
    );
  } else {
    parts.push(
      h(Section, {
        title: '提示',
        children: h(TopicItem, {
          index: 1,
          title: '安装任意游戏插件',
          summary: 'registerGame 后会自动挂载大厅命令',
        }),
      }),
    );
  }

  if (other.length) {
    parts.push(
      h(Section, {
        title: '其他命令',
        children: other.map((cmd, i) =>
          h(TopicItem, {
            index: i + 1,
            title: cmd.pattern,
            summary: commandTopicSummary(cmd),
          }),
        ),
      }),
    );
  }

  if (channelType === 'group') {
    parts.push(
      h(Section, {
        title: 'QQ 群用法',
        children: [
          h(TopicItem, {
            index: 1,
            title: '公域群需 @ 机器人',
            summary: '发送命令或直接点击消息按钮',
          }),
          h(TopicItem, {
            index: 2,
            title: '/游戏 打开大厅',
            summary: '同群成员均可点击按钮参与',
          }),
        ],
      }),
    );
  }

  return cardShell(parts.join(''));
}

export function buildHubHelpHtml(
  games: readonly RegisteredGame[],
  commands?: readonly CommandHelpSource[],
): string {
  const hubLines = formatHubOpenCommandLines(commands);
  const parts: string[] = [
    h(CardHeader, {
      title: '游戏大厅帮助',
      subtitle: games.length ? `${games.length} 款游戏可选` : '暂无游戏',
      badge: '🎮',
    }),
  ];

  if (hubLines.length) {
    parts.push(
      h(Section, {
        title: '入口',
        children: hubLines.map((line) => {
          const sep = line.indexOf(' — ');
          const pattern = sep >= 0 ? line.slice(0, sep) : line;
          const desc = sep >= 0 ? line.slice(sep + 3) : '';
          return h(KvRow, { label: pattern, value: desc, labelWidth: 72 });
        }),
      }),
    );
  }

  if (games.length) {
    parts.push(
      h(Section, {
        title: '游戏',
        children: games.map((g, i) =>
          h(TopicItem, {
            index: i + 1,
            title: `${g.icon} ${g.title}`,
            summary: gameTopicSummary(g),
          }),
        ),
      }),
    );
  }

  return cardShell(parts.join(''));
}
