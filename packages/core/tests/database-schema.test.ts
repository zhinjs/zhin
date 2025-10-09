import { describe, it, expect } from 'vitest'
import { Database } from '../src/database/index'

describe('数据库Schema系统测试', () => {
  describe('Database.Field 测试', () => {
    it('应该创建基本字段', () => {
      const field = Database.Field.text('用户名')
      expect(field.meta.type).toBe('string')
      expect(field.meta.description).toBe('用户名')
    })

    it('应该支持流畅API', () => {
      const field = Database.Field.text('用户名', 100)
        .required()
        .unique()
        .default('anonymous')

      expect(field.meta.type).toBe('string')
      expect(field.meta.maxLength).toBe(100)
      expect(field.meta.required).toBe(true)
      expect(field.meta.unique).toBe(true)
      expect(field.meta.default).toBe('anonymous')
    })

    it('应该创建不同类型的字段', () => {
      const textField = Database.Field.text('姓名')
      const intField = Database.Field.integer('年龄')
      const boolField = Database.Field.bool('是否激活')

      expect(textField.meta.type).toBe('string')
      expect(intField.meta.type).toBe('number')
      expect(boolField.meta.type).toBe('boolean')
    })

    it('应该支持主键和自增', () => {
      const idField = Database.Field.id('ID')
        .primaryKey()
        .autoIncrement()

      expect(idField.meta.primaryKey).toBe(true)
      expect(idField.meta.autoIncrement).toBe(true)
    })

    it('应该支持外键引用', () => {
      const field = Database.Field.integer('用户ID')
        .references('users', 'id')

      expect(field.meta.references).toEqual({ 
        table: 'users', 
        column: 'id' 
      })
    })
  })

  describe('Database.Schema 测试', () => {
    it('应该创建表模式', () => {
      const userSchema = new Database.Schema('users', {
        id: Database.Field.id('用户ID').primaryKey().autoIncrement(),
        name: Database.Field.text('用户名', 50).required(),
        email: Database.Field.text('邮箱', 100).unique()
      })

      expect(userSchema.tableName).toBe('users')
      expect(userSchema.fields.id).toBeDefined()
      expect(userSchema.fields.name).toBeDefined()
      expect(userSchema.fields.email).toBeDefined()
    })

    it('应该获取主键字段', () => {
      const schema = new Database.Schema('users', {
        id: Database.Field.id('ID').primaryKey(),
        name: Database.Field.text('姓名')
      })

      const primaryKey = schema.getPrimaryKey()
      expect(primaryKey).toBe('id')
    })

    it('应该支持流畅API方法', () => {
      const schema = new Database.Schema('users', {
        id: Database.Field.id('ID').primaryKey(),
        email: Database.Field.text('邮箱'),
        name: Database.Field.text('姓名')
      })
        .primaryKey('id')
        .unique(['email'])
        .addIndex(['name'], { name: 'idx_user_name' })

      expect(schema.options.primaryKey).toBe('id')
      expect(schema.options.indexes).toHaveLength(2)
      
      // 检查唯一约束索引
      const uniqueIndex = schema.options.indexes!.find(idx => idx.unique)
      expect(uniqueIndex).toBeDefined()
      expect(uniqueIndex!.fields).toEqual(['email'])
      
      // 检查命名索引
      const namedIndex = schema.options.indexes!.find(idx => idx.name === 'idx_user_name')
      expect(namedIndex).toBeDefined()
      expect(namedIndex!.fields).toEqual(['name'])
    })

    it('应该支持时间戳', () => {
      const schema = new Database.Schema('users', {
        id: Database.Field.id('ID').primaryKey(),
        name: Database.Field.text('姓名')
      }).timestamps()

      expect(schema.options.timestamps).toBeDefined()
      expect(schema.options.timestamps?.createdAt).toBe('createdAt')
      expect(schema.options.timestamps?.updatedAt).toBe('updatedAt')
    })

    it('应该支持JSON序列化', () => {
      const schema = new Database.Schema('users', {
        id: Database.Field.id('ID').primaryKey(),
        name: Database.Field.text('姓名')
      })

      const json = schema.toJSON()
      expect(json.tableName).toBe('users')
      expect(json.fields).toHaveProperty('id')
      expect(json.fields).toHaveProperty('name')
    })
  })
})
