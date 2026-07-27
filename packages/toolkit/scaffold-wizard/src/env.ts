import type { DatabaseConfig } from './types.js';

/**
 * dotenv 值格式化：含 `#` / 空白 / 引号 / 反斜杠 / 换行 时用双引号包裹并转义，
 * 避免未转义值截断注释或破坏行解析（所有 .env 生成点统一走这里）。
 */
export function formatEnvValue(value: unknown): string {
  const raw = value == null ? '' : String(value);
  if (raw !== '' && !/[#"'\\\s]/.test(raw)) return raw;
  return `"${raw
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}"`;
}

const ENV_KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=/;

/**
 * 幂等合并 .env 内容：extra 中出现的 KEY 覆盖 existing 同名行（原位替换），
 * 新 KEY 连同其段落注释追加到文末。重复执行结果不变。
 */
export function mergeEnvText(existing: string, extra: string): string {
  const entries: Array<{ comment?: string; key: string; line: string }> = [];
  let pendingComment: string | undefined;
  for (const rawLine of extra.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      pendingComment = line;
      continue;
    }
    const match = ENV_KEY_LINE.exec(line);
    if (!match) continue;
    entries.push({ comment: pendingComment, key: match[1], line });
    pendingComment = undefined;
  }
  const out = existing.split('\n');
  if (entries.length === 0) {
    return existing.replace(/\s*$/, '') + (existing.trim() ? '\n' : '');
  }
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const consumed = new Set<string>();
  for (let index = 0; index < out.length; index += 1) {
    const match = ENV_KEY_LINE.exec(out[index].trim());
    if (match && byKey.has(match[1])) {
      out[index] = byKey.get(match[1])!.line;
      consumed.add(match[1]);
    }
  }
  const fresh = entries.filter((entry) => !consumed.has(entry.key));
  if (fresh.length > 0) {
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
    if (out.length > 0) out.push('');
    let lastComment: string | undefined;
    for (const entry of fresh) {
      if (entry.comment && entry.comment !== lastComment) out.push(entry.comment);
      lastComment = entry.comment;
      out.push(entry.line);
    }
  }
  return out.join('\n').replace(/\s*$/, '') + '\n';
}

/** 生成数据库连接环境变量（连接参数落 .env，配置文件只引用 ${VAR}）。 */
export function generateDatabaseEnvVars(config: DatabaseConfig): string {
  const envVars: string[] = [];

  switch (config.dialect) {
    case 'mysql':
      envVars.push(
        '# MySQL 数据库配置',
        `DB_HOST=${formatEnvValue(config.host || 'localhost')}`,
        `DB_PORT=${formatEnvValue(config.port || 3306)}`,
        `DB_USER=${formatEnvValue(config.user || 'root')}`,
        `DB_PASSWORD=${formatEnvValue(config.password || '')}`,
        `DB_DATABASE=${formatEnvValue(config.database || 'zhin_bot')}`
      );
      break;
    case 'pg':
      envVars.push(
        '# PostgreSQL 数据库配置',
        `DB_HOST=${formatEnvValue(config.host || 'localhost')}`,
        `DB_PORT=${formatEnvValue(config.port || 5432)}`,
        `DB_USER=${formatEnvValue(config.user || 'postgres')}`,
        `DB_PASSWORD=${formatEnvValue(config.password || '')}`,
        `DB_DATABASE=${formatEnvValue(config.database || 'zhin_bot')}`
      );
      break;
    case 'mongodb':
      envVars.push(
        '# MongoDB 数据库配置',
        `DB_URL=${formatEnvValue(config.url || 'mongodb://localhost:27017')}`,
        `DB_NAME=${formatEnvValue(config.dbName || 'zhin_bot')}`
      );
      break;
    case 'redis':
      envVars.push(
        '# Redis 数据库配置',
        `REDIS_HOST=${formatEnvValue(config.socket?.host || 'localhost')}`,
        `REDIS_PORT=${formatEnvValue(config.socket?.port || 6379)}`,
        `REDIS_PASSWORD=${formatEnvValue(config.password || '')}`,
        `REDIS_DB=${formatEnvValue(config.database ?? 0)}`
      );
      break;
    case 'sqlite':
    default:
      // SQLite 不需要额外的环境变量
      break;
  }

  return envVars.length > 0 ? `\n\n${envVars.join('\n')}` : '';
}
