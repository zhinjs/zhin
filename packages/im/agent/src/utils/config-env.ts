/**
 * 展开配置字符串中的 ${VAR} / ${VAR:-default}（支持字符串内多处替换，与 ConfigLoader 整串形式兼容）
 */
export function resolveConfigEnvString(
  value: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (value == null) return value;
  if (value.startsWith('\\${') && value.endsWith('}')) return value.slice(1);

  const whole = value.match(/^\$\{([^}]+)\}$/);
  if (whole) {
    return resolveEnvRef(whole[1], env) ?? value;
  }

  return value.replace(/\$\{([^}]+)\}/g, (_m, ref: string) => resolveEnvRef(ref, env) ?? _m);
}

function resolveEnvRef(content: string, env: NodeJS.ProcessEnv): string | undefined {
  let key: string;
  let defaultValue: string | undefined;
  const bashDefaultMatch = content.match(/^([^:}]+):[-=](.*)$/);
  if (bashDefaultMatch) {
    key = bashDefaultMatch[1];
    defaultValue = bashDefaultMatch[2];
  } else {
    key = content;
    defaultValue = undefined;
  }
  const v = env[key];
  if (v != null && v !== '') return v;
  if (defaultValue !== undefined) return defaultValue;
  return undefined;
}
