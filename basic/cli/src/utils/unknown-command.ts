/**
 * Unknown subcommands (#1250 `cli-unknown-command-help-exit0`). Commander prints the parent's help
 * and exits 0 for `zhin endpoint --help` (help is handled before the unknown-command check), which
 * looks like success to a script. The CLI checks the command path itself before parsing: an
 * operand that names no subcommand of a command that only dispatches is an error (exit 1), with
 * the closest command and, for a few common mistakes, the command that does what was meant.
 */
import type { Command } from 'commander';

export interface UnknownCommand {
  /** Path of the command whose subcommand is unknown (`['zhin', 'plugin']`). */
  readonly parent: readonly string[];
  readonly name: string;
  /** Closest subcommand name (`zhin <parent…> <suggestion>`), if any is close enough. */
  readonly suggestion?: string;
  /** Extra guidance for a known mistake. */
  readonly hint?: string;
}

/** Guidance for mistakes users actually make, keyed by `<parent path without zhin> <name>`. */
const HINTS: Readonly<Record<string, string>> = {
  ' endpoint': '查看适配器账号是否在线：zhin status（--json 里是 endpoints）；账号管理在 Console「适配器」页',
  ' endpoints': '查看适配器账号是否在线：zhin status（--json 里是 endpoints）；账号管理在 Console「适配器」页',
  'plugin list': 'zhin plugin 是插件作者工具（目前只有 check）；查看已安装的插件请用 zhin packages list',
  'plugin ls': 'zhin plugin 是插件作者工具（目前只有 check）；查看已安装的插件请用 zhin packages list',
  'plugin install': 'zhin plugin 是插件作者工具；安装插件请用 zhin install <包名>（或 zhin packages install）',
};

function hasAction(command: Command): boolean {
  return typeof Reflect.get(command, '_actionHandler') === 'function';
}

function names(command: Command): string[] {
  return [command.name(), ...command.aliases()];
}

/** Optimal string alignment distance (Damerau-Levenshtein with adjacent transpositions). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  }
  return d[a.length]![b.length]!;
}

/** The closest candidate: a prefix match, or within distance 3 and at least 40 % similar. */
export function closestCommand(word: string, candidates: readonly string[]): string | undefined {
  const lower = word.toLowerCase();
  const prefix = candidates.filter(candidate => candidate.startsWith(lower) || (lower.length >= 3 && lower.startsWith(candidate)));
  if (prefix.length === 1) return prefix[0];
  let best: { name: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = editDistance(lower, candidate);
    const similarity = 1 - distance / Math.max(lower.length, candidate.length);
    if (distance > 3 || similarity <= 0.4) continue;
    if (!best || distance < best.distance) best = { name: candidate, distance };
  }
  return best?.name;
}

/**
 * Walks `args` (process.argv without node and script) down `root`'s subcommands. Options are
 * skipped; the first operand of a command that has subcommands and no action of its own must name
 * one of them (or `help`). Returns undefined when the path is fine or not checkable.
 */
export function findUnknownCommand(root: Command, args: readonly string[]): UnknownCommand | undefined {
  let command = root;
  const path = [root.name()];
  let skipValue = false;
  for (const arg of args) {
    if (skipValue) { skipValue = false; continue; }
    if (arg === '--') return undefined;
    if (arg.startsWith('-')) {
      // `--opt value` of an option that takes a value: the value is not a command name.
      const option = command.options.find(candidate => candidate.long === arg || candidate.short === arg);
      skipValue = option !== undefined && (option.required || option.optional);
      continue;
    }
    if (command.commands.length === 0 || hasAction(command) || Reflect.get(command, '_defaultCommandName')) return undefined;
    const next = command.commands.find(sub => names(sub).includes(arg));
    if (!next) {
      if (arg === 'help') return undefined;
      const candidates = command.commands.flatMap(sub => (Reflect.get(sub, '_hidden') === true ? [] : names(sub)));
      const key = `${path.slice(1).join(' ')} ${arg}`;
      const suggestion = closestCommand(arg, candidates);
      return { parent: path, name: arg, ...(suggestion ? { suggestion } : {}), ...(HINTS[key] ? { hint: HINTS[key] } : {}) };
    }
    command = next;
    path.push(next.name());
  }
  return undefined;
}

/** stderr lines for {@link findUnknownCommand}'s result. */
export function formatUnknownCommand(unknown: UnknownCommand): string[] {
  const lines = [`error: unknown command '${unknown.name}'（${unknown.parent.join(' ')} 没有这个子命令）`];
  if (unknown.suggestion) lines.push(`你是不是想用：${[...unknown.parent, unknown.suggestion].join(' ')}`);
  if (unknown.hint) lines.push(unknown.hint);
  lines.push(`可用命令：${unknown.parent.join(' ')} --help`);
  return lines;
}
