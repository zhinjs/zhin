// 测试数据库格式化修复效果
import { SQLiteDialect } from './packages/database/lib/dialects/sqlite.js';
import { RelatedDatabase } from './packages/database/lib/type/related/database.js';

async function testDatabaseFix() {
  console.log('开始测试数据库格式化修复...');
  
  try {
    // 创建 SQLite 数据库实例
    const dialect = new SQLiteDialect({ filename: ':memory:' });
    const db = new RelatedDatabase(dialect);
    
    await db.start();
    
    // 创建测试表
    await db.query(`
      CREATE TABLE IF NOT EXISTS test_table (
        id INTEGER PRIMARY KEY,
        name TEXT,
        age INTEGER,
        info TEXT
      )
    `);
    
    // 插入测试数据
    await db.query(`
      INSERT INTO test_table (name, age, info) VALUES (?, ?, ?)
    `, ['张三', 25, JSON.stringify({ hobby: '编程' })]);
    
    await db.query(`
      INSERT INTO test_table (name, age, info) VALUES (?, ?, ?)
    `, ['李四', 30, JSON.stringify({ hobby: '阅读' })]);
    
    // 查询数据
    const results = await db.query('SELECT * FROM test_table');
    
    console.log('查询结果:');
    console.log(JSON.stringify(results, null, 2));
    
    // 验证数据格式
    if (results.length > 0) {
      const firstRow = results[0];
      console.log('\n数据格式验证:');
      console.log('name 字段类型:', typeof firstRow.name);
      console.log('name 字段值:', firstRow.name);
      console.log('info 字段类型:', typeof firstRow.info);
      console.log('info 字段值:', firstRow.info);
      
      // 检查是否还有多余的引号
      if (typeof firstRow.name === 'string' && !firstRow.name.startsWith("'")) {
        console.log('✅ 字符串字段格式化成功！');
      } else {
        console.log('❌ 字符串字段仍有格式问题');
      }
      
      // 检查 JSON 字段是否正确解析
      if (typeof firstRow.info === 'object') {
        console.log('✅ JSON 字段解析成功！');
      } else {
        console.log('❌ JSON 字段解析失败');
      }
    }
    
    await db.stop();
    console.log('\n测试完成！');
    
  } catch (error) {
    console.error('测试失败:', error.message);
  }
}

testDatabaseFix();
