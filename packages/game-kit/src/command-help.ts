import type { Message, MessageCommand, Plugin } from '@zhin.js/core';
import type { RegisteredGame } from './game-hub-feature.js';

export interface CommandHelpSource {
  pattern: string;
  helpInfo: {
    desc: string[];
    usage?: string[];
    examples?: string[];
  };
}

export function commandToHelpSource(cmd: Pick<MessageCommand, 'pattern' | 'helpInfo'>): CommandHelpSource {
  return { pattern: cmd.pattern, helpInfo: cmd.helpInfo };
}

/** 按 MessageCommand.permit 与当前消息上下文过滤（与 handle 一致） */
export async function filterHelpCommands(
  commands: readonly MessageCommand[],
  message: Message,
  plugin: Plugin,
): Promise<CommandHelpSource[]> {
  const out: CommandHelpSource[] = [];
  for (const cmd of commands) {
    if (await cmd.checkPermits(message, plugin)) {
      out.push(commandToHelpSource(cmd));
    }
  }
  return out;
}

function commandLeadingToken(pattern: string): string {
  return pattern.split(/\s/)[0] ?? '';
}

function normalizeToken(token: string): string {
  return token.replace(/^\//, '').toLowerCase();
}

/** 不在「其他命令」中重复展示的 pattern（大厅入口 / 帮助自身） */
const HELP_EXCLUDE_EXACT = new Set([
  '/帮助',
  '/help',
  '帮助',
  '/游戏 帮助',
  '/游戏',
  '/game',
  '游戏',
  'game',
]);

function isHubListedGameCommand(pattern: string, games: readonly RegisteredGame[]): boolean {
  const lead = normalizeToken(commandLeadingToken(pattern));
  return games.some((g) => normalizeToken(g.commandPrefix) === lead);
}

function comparePatterns(a: string, b: string): number {
  const leadDiff = commandLeadingToken(b).length - commandLeadingToken(a).length;
  if (leadDiff !== 0) return leadDiff;
  return b.length - a.length;
}

function formatPatternDisplay(pattern: string): string {
  return `\`${pattern}\``;
}

function formatCommandHelpLine(cmd: CommandHelpSource): string {
  const [label = '', detail = ''] = cmd.helpInfo.desc;
  const display = formatPatternDisplay(cmd.pattern);
  const summary = detail || label || cmd.pattern;
  if (label && label !== commandLeadingToken(cmd.pattern) && !cmd.pattern.startsWith(label)) {
    return `• ${display}（${label}）— ${summary}`;
  }
  return `• ${display} — ${summary}`;
}

/** 从 command 服务收集应在 /帮助 中展示的命令（去重、排除已在游戏大厅列出的项） */
export function collectSupplementaryCommandHelp(
  commands: readonly CommandHelpSource[],
  games: readonly RegisteredGame[],
): CommandHelpSource[] {
  const seen = new Set<string>();
  const out: CommandHelpSource[] = [];
  for (const cmd of [...commands].sort((a, b) => comparePatterns(a.pattern, b.pattern))) {
    if (HELP_EXCLUDE_EXACT.has(cmd.pattern)) continue;
    if (isHubListedGameCommand(cmd.pattern, games)) continue;
    if (seen.has(cmd.pattern)) continue;
    seen.add(cmd.pattern);
    out.push(cmd);
  }
  return out;
}

export function formatSupplementaryCommandsHelp(
  commands: readonly CommandHelpSource[],
  games: readonly RegisteredGame[],
): string {
  const items = collectSupplementaryCommandHelp(commands, games);
  if (!items.length) return '';
  const lines = items.map(formatCommandHelpLine);
  return ['**其他命令**', '', ...lines].join('\n');
}

/** 大厅入口行：从已注册命令的 .desc() 生成 */
export function formatHubOpenCommandLines(
  commands: readonly CommandHelpSource[] | undefined,
): string[] {
  if (!commands?.length) return [];
  const lines: string[] = [];
  for (const pattern of ['/游戏', '/game'] as const) {
    const cmd = commands.find((c) => c.pattern === pattern);
    if (!cmd) continue;
    const desc = cmd.helpInfo.desc[0] ?? cmd.helpInfo.desc[1] ?? '';
    if (desc) lines.push(`${pattern} — ${desc}`);
  }
  return lines;
}
