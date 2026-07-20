/**
 * Plugin Runtime game hub — module-level registry (no legacy Feature / getPlugin).
 * Games call `registerRuntimeGame` from `setup()`; hub plugin lists them.
 */
export interface RuntimeGameMenuAction {
  readonly id: string;
  readonly label: string;
}

export interface RuntimeRegisteredGame {
  readonly id: string;
  readonly title: string;
  readonly icon: string;
  readonly description: string;
  readonly commandPrefix: string;
  readonly quickStart?: string;
  readonly aliases?: readonly string[];
  readonly menus?: readonly RuntimeGameMenuAction[];
}

const games = new Map<string, RuntimeRegisteredGame[]>();

export function registerRuntimeGame(game: RuntimeRegisteredGame): () => void {
  const registered = Object.freeze({ ...game });
  const registrations = games.get(game.id) ?? [];
  registrations.push(registered);
  games.set(game.id, registrations);
  return () => {
    const current = games.get(game.id);
    if (!current) return;
    const index = current.lastIndexOf(registered);
    if (index >= 0) current.splice(index, 1);
    if (current.length === 0) games.delete(game.id);
  };
}

export function getRuntimeGames(): readonly RuntimeRegisteredGame[] {
  const active = [...games.values()]
    .map((registrations) => registrations[registrations.length - 1])
    .filter((game): game is RuntimeRegisteredGame => Boolean(game));
  return Object.freeze(active.sort((a, b) => a.id.localeCompare(b.id)));
}

export function getRuntimeGame(id: string): RuntimeRegisteredGame | undefined {
  const directRegistrations = games.get(id);
  const direct = directRegistrations?.[directRegistrations.length - 1];
  if (direct) return direct;
  // 别名解析（如 bj、ttt、21点）
  for (const registrations of games.values()) {
    const game = registrations[registrations.length - 1];
    if (!game) continue;
    if (game.aliases?.includes(id)) return game;
  }
  return undefined;
}

export function resetRuntimeGamesForTests(): void {
  games.clear();
}

export function formatRuntimeGamesHelp(): string {
  const list = getRuntimeGames();
  if (list.length === 0) {
    return [
      '🎮 游戏大厅',
      '',
      '暂无已加载的游戏插件。',
      '安装并启用 `@zhin.js/plugin-guess-number` 等游戏包后重试。',
    ].join('\n');
  }
  const lines = ['🎮 游戏大厅', '', '已加载：'];
  for (const g of list) {
    const start = g.quickStart ? ` ${g.quickStart}` : '';
    lines.push(`${g.icon} **${g.title}** — \`${g.commandPrefix}${start}\``);
    lines.push(`   ${g.description}`);
  }
  lines.push('');
  lines.push('发送对应命令开始；进行中可按各游戏说明直接回复。');
  return lines.join('\n');
}

/** Default idle timeout for stale-session cron (30 minutes). */
export const DEFAULT_GAME_STALE_IDLE_MS = 30 * 60 * 1000;

/** Solar cron: every 10 minutes. */
export const DEFAULT_GAME_STALE_CRON = '0 */10 * * * *';
