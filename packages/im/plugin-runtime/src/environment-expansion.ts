/**
 * Standalone deep expansion over an arbitrary config value (e.g. a raw `ai`
 * config document before EnvStore scoping exists). Supports `${VAR}` and
 * `${VAR:-default}` / `${VAR:=default}` (default applies when the variable is
 * unset or empty). Missing plain references resolve via `onMissing`
 * (default: `""`, matching `EnvStore.expandMissingAsEmpty`).
 */
export function expandEnvironmentValue<T>(
  value: T,
  lookup: (key: string) => string | undefined,
  onMissing: (key: string) => string = () => '',
): T {
  return expandValue(value, lookup, onMissing) as T;
}

function expandValue(
  value: unknown,
  lookup: (key: string) => string | undefined,
  onMissing: (key: string) => string,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === 'string') {
    return expandString(value, lookup, onMissing);
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) throw new TypeError('Environment expansion input must be acyclic');
  seen.add(value);
  if (Array.isArray(value)) {
    const result = Object.freeze(value.map((item) => expandValue(item, lookup, onMissing, seen)));
    seen.delete(value);
    return result;
  }
  if (!isPlainRecord(value)) {
    seen.delete(value);
    return value;
  }
  const result = Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, expandValue(item, lookup, onMissing, seen)]),
  ));
  seen.delete(value);
  return result;
}

function isEnvKeyStart(ch: string): boolean {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_';
}

function isEnvKeyChar(ch: string): boolean {
  return isEnvKeyStart(ch) || (ch >= '0' && ch <= '9');
}

/**
 * 线性扫描展开 `${VAR}` 与 `${VAR:-default}` / `${VAR:=default}`。
 * 语义与正则 `/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::[-=]([^}]*))?\}/gu` 完全一致
 * （解析失败时从 `${` 之后重新找下一个候选，等价于正则引擎逐位后移），
 * 但全程无回溯（js/polynomial-redos）。
 */
function expandString(
  input: string,
  lookup: (key: string) => string | undefined,
  onMissing: (key: string) => string,
): string {
  let out = '';
  let i = 0;
  while (i < input.length) {
    const start = input.indexOf('${', i);
    if (start < 0) break;
    let j = start + 2;
    const first = input[j];
    if (first === undefined || !isEnvKeyStart(first)) {
      out += input.slice(i, start + 1);
      i = start + 1;
      continue;
    }
    j += 1;
    while (j < input.length) {
      const character = input[j];
      if (character === undefined || !isEnvKeyChar(character)) break;
      j += 1;
    }
    const key = input.slice(start + 2, j);
    let fallback: string | undefined;
    if (input[j] === ':' && (input[j + 1] === '-' || input[j + 1] === '=')) {
      const close = input.indexOf('}', j + 2);
      if (close < 0) {
        out += input.slice(i, start + 1);
        i = start + 1;
        continue;
      }
      fallback = input.slice(j + 2, close);
      j = close;
    }
    if (input[j] !== '}') {
      out += input.slice(i, start + 1);
      i = start + 1;
      continue;
    }
    out += input.slice(i, start);
    const resolved = lookup(key);
    if (fallback !== undefined) {
      out += resolved !== undefined && resolved !== '' ? resolved : fallback;
    } else if (resolved !== undefined) {
      out += resolved;
    } else {
      out += onMissing(key);
    }
    i = j + 1;
  }
  return out + input.slice(i);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
