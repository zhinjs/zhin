/**
 * 示例 3: 数据库插件
 * 
 * 展示：
 * - 资源管理
 * - 手动清理与自动清理结合
 * - 错误处理
 * - 异步操作
 */

import { onMount, onDispose } from '@zhin.js/dependency';

console.log('💾 [Database Plugin] 模块已加载');

// 模拟数据库连接
class DatabaseConnection {
  private connected = false;
  private queryCount = 0;
  
  async connect() {
    console.log('💾 [Database] 正在连接数据库...');
    // 模拟连接延迟
    await new Promise(resolve => setTimeout(resolve, 1000));
    this.connected = true;
    console.log('✅ [Database] 数据库连接成功');
  }
  
  async query(sql: string) {
    if (!this.connected) {
      throw new Error('数据库未连接');
    }
    this.queryCount++;
    console.log(`📊 [Database] 执行查询 #${this.queryCount}: ${sql}`);
    // 模拟查询延迟
    await new Promise(resolve => setTimeout(resolve, 100));
    return { success: true, rows: [] };
  }
  
  async disconnect() {
    if (this.connected) {
      console.log('💾 [Database] 正在断开数据库连接...');
      this.connected = false;
      console.log(`📊 [Database] 总共执行了 ${this.queryCount} 次查询`);
    }
  }
}

let db: DatabaseConnection;

onMount(async () => {
  console.log('✅ [Database Plugin] 插件已挂载');
  
  // 创建并连接数据库
  db = new DatabaseConnection();
  await db.connect();
  
  // 定期执行查询（使用自动清理的定时器）
  setInterval(async () => {
    try {
      await db.query('SELECT * FROM users');
    } catch (error) {
      console.error('❌ [Database] 查询失败:', error);
    }
  }, 2000);
  
  // 延时查询
  setTimeout(async () => {
    await db.query('SELECT COUNT(*) FROM posts');
  }, 3000);
});

// 手动清理数据库连接
onDispose(async () => {
  console.log('🛑 [Database Plugin] 插件正在卸载');
  if (db) {
    await db.disconnect();
  }
  // 注意：定时器会自动清理，无需手动处理
});

// 导出查询函数供其他插件使用
export async function query(sql: string) {
  if (!db) {
    throw new Error('数据库插件未初始化');
  }
  return db.query(sql);
}

export default {
  name: 'database',
  version: '1.0.0'
};

