import { wizardText } from '@zhin.js/scaffold-wizard';
import { randomBytes } from 'node:crypto';

// 项目名称只能包含字母、数字、横线和下划线
export const PROJECT_NAME_PATTERN = /^[a-zA-Z0-9-_]+$/;

export function isValidProjectName(name: string): boolean {
  return PROJECT_NAME_PATTERN.test(name);
}

// 生成随机 token（hex 格式）
export function generateToken(bytes: number = 16, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
  if (bytes < 1) {
    throw new Error(wizardText(locale, "bytes 必须大于 0"));
  }
  return randomBytes(bytes).toString('hex');
}

/**
 * 终端里展示密钥时只说明长度，不显示任何字符：create 的输出常被 CI 日志收集。
 * 完整值只写入 `.env`。
 */
export function maskSecret(secret: string, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
  return wizardText(locale, "********（{v0} 位，已隐藏）", [secret.length]);
}

/** Remote Console 登录提示里的 Token 行：打码，并指出完整值的存放位置。 */
export function describeStoredHttpToken(httpToken: string, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
  return wizardText(locale, "{v0}，完整值见项目根目录 .env 的 HTTP_TOKEN", [maskSecret(httpToken, locale)]);
}

// 获取数据库显示名称
export function getDatabaseDisplayName(dialect: string): string {
  const names = {
    sqlite: 'SQLite',
    mysql: 'MySQL',
    pg: 'PostgreSQL', 
    mongodb: 'MongoDB',
    redis: 'Redis',
    memory: 'Memory'
  };
  return names[dialect as keyof typeof names] || dialect;
}

export function getDatabasePersistenceLabel(dialect: string, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
  if (dialect === 'memory') return wizardText(locale, "Memory（仅进程内，不持久化）");
  return wizardText(locale, "{v0} 持久化", [getDatabaseDisplayName(dialect)]);
}
