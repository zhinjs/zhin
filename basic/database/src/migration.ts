import { 
  Migration, 
  MigrationContext, 
  MigrationRecord, 
  MigrationStatus,
  MigrationRunnerConfig,
  MigrationOperation,
  Column 
} from './types.js';
import { RelatedDatabase } from './type/related/database.js';

/**
 * 记录型迁移上下文
 * 在执行操作的同时记录所有操作，用于自动生成 down
 */
class RecordingMigrationContext implements MigrationContext {
  private _operations: MigrationOperation[] = [];
  
  constructor(private readonly baseContext: MigrationContext) {}
  
  get operations(): MigrationOperation[] {
    return this._operations;
  }
  
  async createTable(tableName: string, columns: Record<string, Column>): Promise<void> {
    this._operations.push({ type: 'createTable', tableName, columns });
    await this.baseContext.createTable(tableName, columns);
  }
  
  async dropTable(tableName: string): Promise<void> {
    this._operations.push({ type: 'dropTable', tableName });
    await this.baseContext.dropTable(tableName);
  }
  
  async addColumn(tableName: string, columnName: string, column: Column): Promise<void> {
    this._operations.push({ type: 'addColumn', tableName, columnName, column });
    await this.baseContext.addColumn(tableName, columnName, column);
  }
  
  async dropColumn(tableName: string, columnName: string): Promise<void> {
    this._operations.push({ type: 'dropColumn', tableName, columnName });
    await this.baseContext.dropColumn(tableName, columnName);
  }
  
  async modifyColumn(tableName: string, columnName: string, column: Column): Promise<void> {
    // modifyColumn 不能自动反向，需要原始列定义
    await this.baseContext.modifyColumn(tableName, columnName, column);
  }
  
  async renameColumn(tableName: string, oldName: string, newName: string): Promise<void> {
    this._operations.push({ type: 'renameColumn', tableName, oldName, newName });
    await this.baseContext.renameColumn(tableName, oldName, newName);
  }
  
  async addIndex(tableName: string, indexName: string, columns: string[], unique?: boolean): Promise<void> {
    this._operations.push({ type: 'addIndex', tableName, indexName, columns, unique });
    await this.baseContext.addIndex(tableName, indexName, columns, unique);
  }
  
  async dropIndex(tableName: string, indexName: string): Promise<void> {
    this._operations.push({ type: 'dropIndex', tableName, indexName });
    await this.baseContext.dropIndex(tableName, indexName);
  }
  
  async query<T = any>(sql: string, params?: any[]): Promise<T> {
    // query 操作记录但无法自动反向
    this._operations.push({ type: 'query', sql, params });
    return this.baseContext.query<T>(sql, params);
  }
}

/**
 * 根据 up 操作自动生成 down 操作
 */
function generateReverseOperations(operations: MigrationOperation[]): MigrationOperation[] {
  const reversed: MigrationOperation[] = [];
  
  // 反向遍历操作列表
  for (let i = operations.length - 1; i >= 0; i--) {
    const op = operations[i];
    
    switch (op.type) {
      case 'createTable':
        // createTable -> dropTable
        reversed.push({ type: 'dropTable', tableName: op.tableName });
        break;
        
      case 'dropTable':
        // dropTable 无法自动反向（需要原始表结构）
        throw new Error(`Cannot auto-reverse 'dropTable("${op.tableName}")'. Please provide explicit 'down' function.`);
        
      case 'addColumn':
        // addColumn -> dropColumn
        reversed.push({ type: 'dropColumn', tableName: op.tableName, columnName: op.columnName });
        break;
        
      case 'dropColumn':
        // dropColumn 无法自动反向（需要原始列定义）
        throw new Error(`Cannot auto-reverse 'dropColumn("${op.tableName}", "${op.columnName}")'. Please provide explicit 'down' function.`);
        
      case 'addIndex':
        // addIndex -> dropIndex
        reversed.push({ type: 'dropIndex', tableName: op.tableName, indexName: op.indexName });
        break;
        
      case 'dropIndex':
        // dropIndex 无法自动反向（需要原始索引定义）
        throw new Error(`Cannot auto-reverse 'dropIndex("${op.tableName}", "${op.indexName}")'. Please provide explicit 'down' function.`);
        
      case 'renameColumn':
        // renameColumn -> renameColumn (反向)
        reversed.push({ type: 'renameColumn', tableName: op.tableName, oldName: op.newName, newName: op.oldName });
        break;
        
      case 'query':
        // query 无法自动反向
        throw new Error(`Cannot auto-reverse raw query. Please provide explicit 'down' function.`);
    }
  }
  
  return reversed;
}

/**
 * 执行反向操作
 */
async function executeReverseOperations(context: MigrationContext, operations: MigrationOperation[]): Promise<void> {
  for (const op of operations) {
    switch (op.type) {
      case 'dropTable':
        await context.dropTable(op.tableName);
        break;
      case 'dropColumn':
        await context.dropColumn(op.tableName, op.columnName);
        break;
      case 'dropIndex':
        await context.dropIndex(op.tableName, op.indexName);
        break;
      case 'renameColumn':
        await context.renameColumn(op.tableName, op.oldName, op.newName);
        break;
    }
  }
}

/**
 * 迁移运行器
 * 管理数据库迁移的执行、回滚和状态跟踪
 * 
 * @example
 * ```ts
 * const runner = new MigrationRunner(db);
 * 
 * // 添加迁移
 * runner.add({
 *   name: '001_create_users',
 *   up: async (ctx) => {
 *     await ctx.createTable('users', {
 *       id: { type: 'integer', primary: true, autoIncrement: true },
 *       name: { type: 'text', nullable: false }
 *     });
 *   },
 *   down: async (ctx) => {
 *     await ctx.dropTable('users');
 *   }
 * });
 * 
 * // 运行所有待执行的迁移
 * await runner.migrate();
 * 
 * // 回滚最后一批迁移
 * await runner.rollback();
 * ```
 */
export class MigrationRunner<D = any, S extends Record<string, object> = Record<string, object>> {
  private migrations: Migration[] = [];
  private tableName: string;
  private currentBatch: number = 0;
  
  constructor(
    private readonly database: RelatedDatabase<D, S>,
    config?: MigrationRunnerConfig
  ) {
    this.tableName = config?.tableName || '_migrations';
  }
  
  /**
   * 添加迁移
   */
  add(migration: Migration): this {
    this.migrations.push(migration);
    return this;
  }
  
  /**
   * 批量添加迁移
   */
  addAll(migrations: Migration[]): this {
    this.migrations.push(...migrations);
    return this;
  }
  
  /**
   * 初始化迁移表
   */
  private async ensureMigrationTable(): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS "${this.tableName}" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        batch INTEGER NOT NULL,
        operations TEXT,
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await this.database.query(sql);
  }
  
  /**
   * 获取已执行的迁移
   */
  private async getExecutedMigrations(): Promise<MigrationRecord[]> {
    const sql = `SELECT id, name, batch, executed_at as executedAt FROM "${this.tableName}" ORDER BY id ASC`;
    return this.database.query<MigrationRecord[]>(sql);
  }
  
  /**
   * 获取当前批次号
   */
  private async getCurrentBatch(): Promise<number> {
    const sql = `SELECT MAX(batch) as maxBatch FROM "${this.tableName}"`;
    const result = await this.database.query<{ maxBatch: number | null }[]>(sql);
    return result[0]?.maxBatch || 0;
  }
  
  /**
   * 记录迁移执行
   */
  private async recordMigration(name: string, batch: number, operations?: MigrationOperation[]): Promise<void> {
    const operationsJson = operations ? JSON.stringify(operations) : null;
    const sql = `INSERT INTO "${this.tableName}" (name, batch, operations) VALUES (?, ?, ?)`;
    await this.database.query(sql, [name, batch, operationsJson]);
  }
  
  /**
   * 获取迁移记录的操作
   */
  private async getMigrationOperations(name: string): Promise<MigrationOperation[] | null> {
    const sql = `SELECT operations FROM "${this.tableName}" WHERE name = ?`;
    const result = await this.database.query<{ operations: string | null }[]>(sql, [name]);
    if (result.length === 0 || !result[0].operations) {
      return null;
    }
    const ops = result[0].operations;
    // processFieldValue 可能已经自动解析了 JSON 字符串
    return typeof ops === 'string' ? JSON.parse(ops) : ops as unknown as MigrationOperation[];
  }
  
  /**
   * 删除迁移记录
   */
  private async removeMigrationRecord(name: string): Promise<void> {
    const sql = `DELETE FROM "${this.tableName}" WHERE name = ?`;
    await this.database.query(sql, [name]);
  }
  
  /**
   * 创建迁移上下文
   */
  private createContext(): MigrationContext {
    const db = this.database;
    
    return {
      async createTable(tableName: string, columns: Record<string, Column>): Promise<void> {
        const columnDefs = Object.entries(columns).map(([name, col]) => {
          let def = `"${name}" ${mapColumnType(col.type)}`;
          if (col.primary) def += ' PRIMARY KEY';
          if (col.autoIncrement) def += ' AUTOINCREMENT';
          if (col.unique) def += ' UNIQUE';
          if (!col.nullable) def += ' NOT NULL';
          if (col.default !== undefined) def += ` DEFAULT ${formatDefault(col.default)}`;
          return def;
        }).join(', ');
        
        const sql = `CREATE TABLE IF NOT EXISTS "${tableName}" (${columnDefs})`;
        await db.query(sql);
      },
      
      async dropTable(tableName: string): Promise<void> {
        const sql = `DROP TABLE IF EXISTS "${tableName}"`;
        await db.query(sql);
      },
      
      async addColumn(tableName: string, columnName: string, column: Column): Promise<void> {
        let def = `"${columnName}" ${mapColumnType(column.type)}`;
        if (column.unique) def += ' UNIQUE';
        if (!column.nullable) def += ' NOT NULL';
        if (column.default !== undefined) def += ` DEFAULT ${formatDefault(column.default)}`;
        
        const sql = `ALTER TABLE "${tableName}" ADD COLUMN ${def}`;
        await db.query(sql);
      },
      
      async dropColumn(tableName: string, columnName: string): Promise<void> {
        const sql = `ALTER TABLE "${tableName}" DROP COLUMN "${columnName}"`;
        await db.query(sql);
      },
      
      async modifyColumn(tableName: string, columnName: string, column: Column): Promise<void> {
        // 注意：SQLite 不支持直接 MODIFY COLUMN，需要重建表
        // 这里提供一个简化的实现，完整实现需要更复杂的逻辑
        throw new Error('modifyColumn is not supported in SQLite. Consider recreating the table.');
      },
      
      async renameColumn(tableName: string, oldName: string, newName: string): Promise<void> {
        const sql = `ALTER TABLE "${tableName}" RENAME COLUMN "${oldName}" TO "${newName}"`;
        await db.query(sql);
      },
      
      async addIndex(tableName: string, indexName: string, columns: string[], unique = false): Promise<void> {
        const uniqueStr = unique ? 'UNIQUE ' : '';
        const colStr = columns.map(c => `"${c}"`).join(', ');
        const sql = `CREATE ${uniqueStr}INDEX IF NOT EXISTS "${indexName}" ON "${tableName}" (${colStr})`;
        await db.query(sql);
      },
      
      async dropIndex(tableName: string, indexName: string): Promise<void> {
        const sql = `DROP INDEX IF EXISTS "${indexName}"`;
        await db.query(sql);
      },
      
      async query<T = any>(sql: string, params?: any[]): Promise<T> {
        return db.query<T>(sql, params);
      }
    };
  }
  
  /**
   * 获取迁移状态
   */
  async status(): Promise<MigrationStatus[]> {
    await this.ensureMigrationTable();
    const executed = await this.getExecutedMigrations();
    const executedNames = new Set(executed.map(m => m.name));
    
    const result: MigrationStatus[] = [];
    
    // 已执行的迁移
    for (const record of executed) {
      result.push({
        name: record.name,
        status: 'executed',
        batch: record.batch,
        executedAt: record.executedAt
      });
    }
    
    // 待执行的迁移
    for (const migration of this.migrations) {
      if (!executedNames.has(migration.name)) {
        result.push({
          name: migration.name,
          status: 'pending'
        });
      }
    }
    
    return result;
  }
  
  /**
   * 运行所有待执行的迁移
   */
  async migrate(): Promise<string[]> {
    await this.ensureMigrationTable();
    const executed = await this.getExecutedMigrations();
    const executedNames = new Set(executed.map(m => m.name));
    
    const pending = this.migrations.filter(m => !executedNames.has(m.name));
    
    if (pending.length === 0) {
      return [];
    }
    
    const batch = (await this.getCurrentBatch()) + 1;
    const baseContext = this.createContext();
    const migrated: string[] = [];
    
    for (const migration of pending) {
      try {
        // 如果没有显式的 down，使用记录型上下文来记录操作
        if (!migration.down) {
          const recordingContext = new RecordingMigrationContext(baseContext);
          await migration.up(recordingContext);
          // 验证操作可以反向（提前检查）
          generateReverseOperations(recordingContext.operations);
          await this.recordMigration(migration.name, batch, recordingContext.operations);
        } else {
          await migration.up(baseContext);
          await this.recordMigration(migration.name, batch);
        }
        migrated.push(migration.name);
      } catch (error) {
        // 迁移失败，抛出错误
        throw new Error(`Migration "${migration.name}" failed: ${(error as Error).message}`);
      }
    }
    
    return migrated;
  }
  
  /**
   * 回滚最后一批迁移
   */
  async rollback(): Promise<string[]> {
    await this.ensureMigrationTable();
    const currentBatch = await this.getCurrentBatch();
    
    if (currentBatch === 0) {
      return [];
    }
    
    // 获取最后一批的迁移
    const sql = `SELECT name FROM "${this.tableName}" WHERE batch = ? ORDER BY id DESC`;
    const lastBatch = await this.database.query<{ name: string }[]>(sql, [currentBatch]);
    
    const context = this.createContext();
    const rolledBack: string[] = [];
    
    for (const record of lastBatch) {
      const migration = this.migrations.find(m => m.name === record.name);
      if (!migration) {
        throw new Error(`Migration "${record.name}" not found in registered migrations`);
      }
      
      try {
        if (migration.down) {
          // 使用显式的 down 函数
          await migration.down(context);
        } else {
          // 自动生成并执行反向操作
          const operations = await this.getMigrationOperations(record.name);
          if (!operations) {
            throw new Error(`No recorded operations found for migration "${record.name}". Cannot auto-rollback.`);
          }
          const reverseOps = generateReverseOperations(operations);
          await executeReverseOperations(context, reverseOps);
        }
        await this.removeMigrationRecord(record.name);
        rolledBack.push(record.name);
      } catch (error) {
        throw new Error(`Rollback "${record.name}" failed: ${(error as Error).message}`);
      }
    }
    
    return rolledBack;
  }
  
  /**
   * 回滚所有迁移
   */
  async reset(): Promise<string[]> {
    const allRolledBack: string[] = [];
    
    let batch = await this.getCurrentBatch();
    while (batch > 0) {
      const rolledBack = await this.rollback();
      allRolledBack.push(...rolledBack);
      batch = await this.getCurrentBatch();
    }
    
    return allRolledBack;
  }
  
  /**
   * 重新运行所有迁移（reset + migrate）
   */
  async refresh(): Promise<{ rolledBack: string[]; migrated: string[] }> {
    const rolledBack = await this.reset();
    const migrated = await this.migrate();
    return { rolledBack, migrated };
  }
}

/**
 * 映射列类型到 SQL 类型
 */
function mapColumnType(type: string): string {
  const typeMap: Record<string, string> = {
    'text': 'TEXT',
    'integer': 'INTEGER',
    'float': 'REAL',
    'boolean': 'INTEGER',
    'date': 'DATETIME',
    'json': 'TEXT'
  };
  return typeMap[type] || type.toUpperCase();
}

/**
 * 格式化默认值
 */
function formatDefault(value: any): string {
  if (value === null) return 'NULL';
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

/**
 * 创建迁移辅助函数
 * 
 * @example
 * // 只需要定义 up，down 会自动生成
 * defineMigration({
 *   name: '001_create_users',
 *   up: async (ctx) => {
 *     await ctx.createTable('users', {
 *       id: { type: 'integer', primary: true, autoIncrement: true },
 *       name: { type: 'text', nullable: false }
 *     });
 *     await ctx.addIndex('users', 'idx_name', ['name']);
 *   }
 *   // down 自动生成: dropIndex + dropTable
 * });
 * 
 * // 如果需要自定义 down，可以显式提供
 * defineMigration({
 *   name: '002_custom_migration',
 *   up: async (ctx) => {
 *     await ctx.query('INSERT INTO settings VALUES (?, ?)', ['key', 'value']);
 *   },
 *   down: async (ctx) => {
 *     await ctx.query('DELETE FROM settings WHERE key = ?', ['key']);
 *   }
 * });
 */
export function defineMigration(config: {
  name: string;
  version?: string | number;
  up: (context: MigrationContext) => Promise<void>;
  down?: (context: MigrationContext) => Promise<void>;
}): Migration {
  return config as Migration;
}

