import os from 'os';

// 生成随机密码
export function generateRandomPassword(length: number = 6): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
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