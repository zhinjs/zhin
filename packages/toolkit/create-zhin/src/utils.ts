import { randomBytes } from 'node:crypto';

// 项目名称只能包含字母、数字、横线和下划线
export const PROJECT_NAME_PATTERN = /^[a-zA-Z0-9-_]+$/;

export function isValidProjectName(name: string): boolean {
  return PROJECT_NAME_PATTERN.test(name);
}

// 生成随机 token（hex 格式）
export function generateToken(bytes: number = 16): string {
  if (bytes < 1) {
    throw new Error('bytes 必须大于 0');
  }
  return randomBytes(bytes).toString('hex');
}

// 获取数据库显示名称
export function getDatabaseDisplayName(dialect: string): string {
  const names = {
    sqlite: 'SQLite',
    mysql: 'MySQL',
    pg: 'PostgreSQL', 
    mongodb: 'MongoDB',
    redis: 'Redis'
  };
  return names[dialect as keyof typeof names] || dialect;
}