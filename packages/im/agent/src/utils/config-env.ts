/**
 * 展开配置字符串中的 ${VAR} / ${VAR:-default}（支持字符串内多处替换，与 ConfigLoader 整串形式兼容）
 */
export function resolveConfigEnvString(
  value: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (value == null) return value;
  if (value.startsWith('\\${') && value.endsWith('}')) return value.slice(1);

  const whole = readWholeEnvRef(value);
  if (whole) {
    return resolveEnvRef(whole, env) ?? value;
  }

  return expandInlineEnvRefs(value, env);
}

function readWholeEnvRef(value: string): string | null {
  return value.startsWith('${') && value.endsWith('}') && value.indexOf('${', 2) < 0
    ? value.slice(2, -1)
    : null;
}

function expandInlineEnvRefs(value: string, env: NodeJS.ProcessEnv): string {
  let out = '';
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf('${', cursor);
    if (start < 0) break;
    const end = value.indexOf('}', start + 2);
    if (end < 0) break;
    out += value.slice(cursor, start);
    const raw = value.slice(start, end + 1);
    const ref = value.slice(start + 2, end);
    out += resolveEnvRef(ref, env) ?? raw;
    cursor = end + 1;
  }
  return out + value.slice(cursor);
}

function resolveEnvRef(content: string, env: NodeJS.ProcessEnv): string | undefined {
  let key: string;
  let defaultValue: string | undefined;
  const defaultSep = content.indexOf(':-') >= 0 ? content.indexOf(':-') : content.indexOf(':=');
  if (defaultSep >= 0) {
    key = content.slice(0, defaultSep);
    defaultValue = content.slice(defaultSep + 2);
  } else {
    key = content;
    defaultValue = undefined;
  }
  const v = env[key];
  if (v != null && v !== '') return v;
  if (defaultValue !== undefined) return defaultValue;
  return undefined;
}
