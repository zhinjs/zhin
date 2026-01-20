import os from 'os';
import { webcrypto } from 'node:crypto';

// 生成随机密码
export function generateRandomPassword(length: number = 6): string {
  if (length < 1) {
    throw new Error('密码长度必须大于 0');
  }
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const randomValues = webcrypto.getRandomValues(new Uint32Array(length));
  return Array.from(randomValues, (value) => chars[value % chars.length]).join('');
}

// 获取当前系统用户名
export function getCurrentUsername(): string {
  return os.userInfo().username || 'admin';
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