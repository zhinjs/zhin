import type { SendContent } from 'zhin.js';
import { buildChoiceKeyboard } from './choice-keyboard.js';
import type { RegisteredGame } from './game-hub-feature.js';

export const HUB_PREFIX = 'hub';

export function hubGameChoiceId(gameId: string): string {
  return `g_${gameId}`;
}

export function hubActionChoiceId(gameId: string, actionId: string): string {
  return `a_${gameId}_${actionId}`;
}

export function parseHubChoiceId(
  choiceId: string,
):
  | { kind: 'game'; gameId: string }
  | { kind: 'action'; gameId: string; actionId: string }
  | { kind: 'back' }
  | null {
  if (choiceId === 'back') return { kind: 'back' };
  if (choiceId.startsWith('g_')) return { kind: 'game', gameId: choiceId.slice(2) };
  if (choiceId.startsWith('a_')) {
    const rest = choiceId.slice(2);
    const sep = rest.indexOf('_');
    if (sep <= 0) return null;
    return {
      kind: 'action',
      gameId: rest.slice(0, sep),
      actionId: rest.slice(sep + 1),
    };
  }
  return null;
}

export function buildMainHubMenu(scopeId: string, games: readonly RegisteredGame[]): SendContent {
  const cmdHint = formatCommandPrefixHint(games);
  const lines = [
    '🎮 **游戏大厅**',
    '',
    cmdHint,
    '',
    '_同频道均可浏览；开局后仅对局玩家可操作棋盘。_',
    '',
  ];
  for (const g of games) {
    lines.push(`• ${g.icon} **${g.title}** — ${g.description}`);
  }

  return buildChoiceKeyboard({
    gamePrefix: HUB_PREFIX,
    sessionId: scopeId,
    narrative: lines.join('\n'),
    choices: games.map((g) => ({
      id: hubGameChoiceId(g.id),
      label: `${g.icon} ${g.title}`,
      style: 'primary' as const,
    })),
    buttonsPerRow: 2,
    fallbackHint: '回复数字进入对应游戏',
  });
}

export function buildGameHubMenu(
  scopeId: string,
  game: RegisteredGame,
  channelType: string,
): SendContent {
  const isGroup = channelType !== 'private';
  const menus = game.menus.filter((m) => {
    if (m.groupOnly && !isGroup) return false;
    if (m.privateOnly && isGroup) return false;
    return true;
  });

  return buildChoiceKeyboard({
    gamePrefix: HUB_PREFIX,
    sessionId: scopeId,
    narrative: `${game.icon} **${game.title}**\n\n${game.description}\n\n请选择：`,
    choices: [
      ...menus.map((m) => ({
        id: hubActionChoiceId(game.id, m.id),
        label: m.label,
        style: m.style,
      })),
      { id: 'back', label: '↩️ 返回大厅' },
    ],
    buttonsPerRow: 2,
    fallbackHint: '回复数字选择操作',
  });
}

/** 大厅主菜单：命令前缀提示 */
export function formatCommandPrefixHint(games: readonly RegisteredGame[]): string {
  if (!games.length) return '暂无可用游戏。';
  const sample = games.slice(0, 5).map((g) => g.commandPrefix);
  const tail = games.length > sample.length ? '等' : '';
  return `选择想玩的游戏（也可直接发送中文命令，如「${sample.join('」「')}」${tail}）：`;
}

/** 游戏大厅帮助文案（随 registerGame 动态生成） */
export function formatHubHelp(games: readonly RegisteredGame[]): string {
  const lines = [
    '🎮 **游戏大厅**',
    '',
    '游戏 — 打开可点击的游戏菜单',
    'game — 同上（英文）',
  ];

  if (!games.length) {
    lines.push('', '当前暂无已注册游戏。', '请安装任意游戏插件（registerGame 会自动挂载大厅）。');
    return lines.join('\n');
  }

  lines.push('', `当前已注册 **${games.length}** 款游戏：`, '');

  for (const g of games) {
    const quick = g.quickStart ?? '开始';
    const alias = g.aliases?.length ? ` · ${g.aliases.join(' / ')}` : '';
    lines.push(`• ${g.icon} **${g.title}**${alias}`);
    lines.push(`  命令：\`${g.commandPrefix} ${quick}\` — ${g.description}`);
  }

  return lines.join('\n');
}

/** 无游戏时的提示 */
export function formatHubEmptyMessage(): string {
  return [
    '游戏大厅暂无可用游戏。',
    '请安装任意游戏插件；首个游戏 registerGame 时会自动挂载大厅命令。',
  ].join('');
}
