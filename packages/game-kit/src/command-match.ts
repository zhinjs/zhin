/**
 * 游戏短口令（`21点 开始`、`接龙 继续`、`猜拳 石头`）走命令系统自己的 `match`（#1250 第 82 批）。
 *
 * 短口令都是日常用词（`二十一点 开会`、`接龙 今天天气不错`），所以不能当命令 `alias`——alias 一命中，
 * 后面跟什么都归这条命令。这里把「口令词 + 该游戏认识的动作词」写成一条严格正则交给
 * `defineCommand({ match })`：整句正好是口令（可带一个已知动作）才算命令，照常经过指令前缀、
 * permit、冷却与结局记录；其余文本不归游戏，照常交给后续中间件与 AI。
 */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function alternation(words: readonly string[]): string {
  const unique = [...new Set(words.map((word) => word.trim()).filter(Boolean))];
  if (unique.length === 0) throw new TypeError('gameCommandMatch needs at least one word');
  // Longest first, so `轮盘赌` is not cut to `轮盘`.
  return unique.sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
}

/**
 * `defineCommand({ match })` for a game's short words: the whole text is one of `words`, optionally
 * followed by one of `actions` (case-insensitive), captured as the `action` group.
 */
export function gameCommandMatch(words: readonly string[], actions: readonly string[]): RegExp {
  return new RegExp(`^(?:${alternation(words)})(?:\\s+(?<action>${alternation(actions)}))?$`, 'iu');
}

/**
 * The action a game command was sent with: its route parameter (`bj 开始`, `玩二十一点 开始`), else the
 * action a {@link gameCommandMatch} hit captured (`21点 开始`); `''` when bare.
 */
export function gameCommandAction(context: Readonly<{
  params: Readonly<Record<string, unknown>>;
  match?: Readonly<RegExpExecArray>;
}>, param = 'action'): string {
  const routed = context.params[param];
  if (typeof routed === 'string' && routed.trim()) return routed;
  return context.match?.groups?.action ?? '';
}
