/**
 * Migration 工具函数测试
 * 测试 generateReverseOperations 逻辑
 */
import { describe, it, expect } from 'vitest';
import type { MigrationOperation, Column } from '../src/types.js';
import { generateReverseOperations } from '../src/migration.js';

describe('generateReverseOperations', () => {
  it('createTable 应反转为 dropTable', () => {
    const ops: MigrationOperation[] = [
      { type: 'createTable', tableName: 'users', columns: { id: { type: 'integer' } } },
    ];
    const reversed = generateReverseOperations(ops);
    expect(reversed).toEqual([{ type: 'dropTable', tableName: 'users' }]);
  });

  it('addColumn 应反转为 dropColumn', () => {
    const ops: MigrationOperation[] = [
      { type: 'addColumn', tableName: 'users', columnName: 'email', column: { type: 'text' } },
    ];
    const reversed = generateReverseOperations(ops);
    expect(reversed).toEqual([{ type: 'dropColumn', tableName: 'users', columnName: 'email' }]);
  });

  it('addIndex 应反转为 dropIndex', () => {
    const ops: MigrationOperation[] = [
      { type: 'addIndex', tableName: 'users', indexName: 'idx_email', columns: ['email'] },
    ];
    const reversed = generateReverseOperations(ops);
    expect(reversed).toEqual([{ type: 'dropIndex', tableName: 'users', indexName: 'idx_email' }]);
  });

  it('renameColumn 应反转列名', () => {
    const ops: MigrationOperation[] = [
      { type: 'renameColumn', tableName: 'users', oldName: 'name', newName: 'full_name' },
    ];
    const reversed = generateReverseOperations(ops);
    expect(reversed).toEqual([{ type: 'renameColumn', tableName: 'users', oldName: 'full_name', newName: 'name' }]);
  });

  it('多个操作应按逆序反转', () => {
    const ops: MigrationOperation[] = [
      { type: 'createTable', tableName: 'posts', columns: { id: { type: 'integer' } } },
      { type: 'addColumn', tableName: 'posts', columnName: 'title', column: { type: 'text' } },
    ];
    const reversed = generateReverseOperations(ops);
    expect(reversed).toHaveLength(2);
    expect(reversed[0]).toEqual({ type: 'dropColumn', tableName: 'posts', columnName: 'title' });
    expect(reversed[1]).toEqual({ type: 'dropTable', tableName: 'posts' });
  });

  it('dropTable 应抛出错误', () => {
    const ops: MigrationOperation[] = [
      { type: 'dropTable', tableName: 'users' },
    ];
    expect(() => generateReverseOperations(ops)).toThrow('Cannot auto-reverse');
  });

  it('dropColumn 应抛出错误', () => {
    const ops: MigrationOperation[] = [
      { type: 'dropColumn', tableName: 'users', columnName: 'email' },
    ];
    expect(() => generateReverseOperations(ops)).toThrow('Cannot auto-reverse');
  });

  it('query 应抛出错误', () => {
    const ops: MigrationOperation[] = [
      { type: 'query', sql: 'DROP TABLE users' },
    ];
    expect(() => generateReverseOperations(ops)).toThrow('Cannot auto-reverse raw query');
  });
});
