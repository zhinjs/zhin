/**
 * Chinese explanations for project config patches that cannot apply (#1250): unknown top-level
 * keys (with close candidates), declaration keys, and array indexes outside the array. Shown by
 * `zhin config set|unset` and the Console; they never name RPCs or revisions.
 */
import type { RuntimeConfigDocument } from '@zhin.js/plugin-runtime';

function displayPath(path: readonly string[]): string {
  return path.join('.');
}

/** Damerau-free Levenshtein distance, enough for "did you mean" suggestions. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

/** Up to three known keys close to `key` (edit distance, prefix or substring). */
export function closeConfigKeys(key: string, known: Iterable<string>): string[] {
  const lower = key.toLowerCase();
  return [...new Set(known)]
    .map(candidate => ({ candidate, score: distance(lower, candidate.toLowerCase()) }))
    .filter(({ candidate, score }) => score <= Math.max(2, Math.floor(key.length / 3))
      || candidate.toLowerCase().startsWith(lower) || lower.startsWith(candidate.toLowerCase())
      || (lower.length >= 3 && candidate.toLowerCase().includes(lower)))
    .sort((left, right) => left.score - right.score || left.candidate.localeCompare(right.candidate))
    .slice(0, 3)
    .map(({ candidate }) => candidate);
}

export function unknownConfigKeyMessage(section: string, known: Iterable<string>): string {
  const close = closeConfigKeys(section, known);
  return `没有这个配置项：${section}（不是 Host 配置，也不是已声明的插件实例）`
    + (close.length > 0 ? `。你是不是想写：${close.join('、')}？` : '。')
    + '要给新插件写配置，先在 Console「插件」页或用 zhin install <包名> 安装并声明它';
}

export function declarationKeyMessage(section: string): string {
  return `${section} 是插件声明，不能用配置补丁修改；请在 Console「插件」页管理插件，或直接编辑配置文件`;
}

/**
 * Why `path` cannot be written in `document` because of an array segment, or undefined. `set`
 * cannot append: an index equal to the length is out of range too.
 */
export function describeArrayPathProblem(document: RuntimeConfigDocument, path: readonly string[], op: 'set' | 'remove'): string | undefined {
  let current: unknown = document;
  for (let index = 0; index < path.length; index++) {
    const segment = path[index]!;
    const here = path.slice(0, index + 1);
    if (Array.isArray(current)) {
      const parent = displayPath(path.slice(0, index));
      if (!/^(0|[1-9]\d*)$/u.test(segment)) {
        return `${parent} 是数组，${displayPath(here)} 里的 "${segment}" 应为数组下标（0–${Math.max(current.length - 1, 0)}）`;
      }
      const position = Number(segment);
      if (position >= current.length) {
        const range = current.length === 0 ? '当前是空数组' : `当前有 ${current.length} 项，下标 0–${current.length - 1}`;
        const append = op === 'set'
          ? `。要追加一项：先用 zhin config get ${parent} 读出整个数组，加上新项后用 zhin config set ${parent} '<JSON 数组>' 整体写回`
          : '';
        return `${displayPath(here)} 超出数组范围（${range}）${append}`;
      }
      current = current[position];
      continue;
    }
    if (!current || typeof current !== 'object') return undefined;
    current = Object.hasOwn(current, segment) ? (current as Record<string, unknown>)[segment] : undefined;
    if (current === undefined) return undefined;
  }
  return undefined;
}
