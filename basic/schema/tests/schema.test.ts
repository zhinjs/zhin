import { describe, it, expect } from 'vitest'
import { Schema } from '../src/index'

describe('Schema', () => {
  describe('Basic types', () => {
    it('should create string schema', () => {
      const schema = Schema.string()
      expect(schema).toBeDefined()
      expect(schema.meta.type).toBe('string')
    })

    it('should create number schema', () => {
      const schema = Schema.number()
      expect(schema).toBeDefined()
      expect(schema.meta.type).toBe('number')
    })

    it('should create boolean schema', () => {
      const schema = Schema.boolean()
      expect(schema).toBeDefined()
      expect(schema.meta.type).toBe('boolean')
    })

    it('should create date schema', () => {
      const schema = Schema.date()
      expect(schema).toBeDefined()
      expect(schema.meta.type).toBe('date')
    })

    it('should create regexp schema', () => {
      const schema = Schema.regexp()
      expect(schema).toBeDefined()
      expect(schema.meta.type).toBe('regexp')
    })
  })

  describe('Complex types', () => {
    it('should create object schema', () => {
      const schema = Schema.object({
        name: Schema.string(),
        age: Schema.number()
      })
      expect(schema).toBeDefined()
      expect(schema.meta.type).toBe('object')
    })

    it('should create list schema', () => {
      const schema = Schema.list(Schema.string())
      expect(schema).toBeDefined()
      expect(schema.meta.type).toBe('list')
    })

    it('should create dict schema', () => {
      const schema = Schema.dict(Schema.number())
      expect(schema).toBeDefined()
      expect(schema.meta.type).toBe('dict')
    })

    it('should create union schema', () => {
      const schema = Schema.union(['option1', 'option2', 'option3'])
      expect(schema).toBeDefined()
    })
  })

  describe('Schema methods', () => {
    it('should set description', () => {
      const schema = Schema.string().description('Test description')
      expect(schema.meta.description).toBe('Test description')
    })

    it('should set default value', () => {
      const schema = Schema.string().default('default value')
      expect(schema.meta.default).toBe('default value')
    })

    it('should set required', () => {
      const schema = Schema.string().required()
      expect(schema.meta.required).toBe(true)
    })

    it('should have meta property', () => {
      const schema = Schema.string()
      expect(schema.meta).toBeDefined()
      expect(schema.meta.type).toBe('string')
    })

    it('should chain multiple methods', () => {
      const schema = Schema.string()
        .description('Name')
        .default('John')
        .required()
      
      expect(schema.meta.description).toBe('Name')
      expect(schema.meta.default).toBe('John')
      expect(schema.meta.required).toBe(true)
    })
  })

  describe('Const schema', () => {
    it('should create const schema with string', () => {
      const schema = Schema.const('constant')
      expect(schema.meta.type).toBe('const')
      expect(schema.meta.default).toBe('constant')
    })

    it('should create const schema with number', () => {
      const schema = Schema.const(42)
      expect(schema.meta.type).toBe('const')
      expect(schema.meta.default).toBe(42)
    })

    it('should create const schema with object', () => {
      const obj = { key: 'value' }
      const schema = Schema.const(obj)
      expect(schema.meta.type).toBe('const')
      expect(schema.meta.default).toBe(obj)
    })
  })

  describe('Schema properties', () => {
    it('should have meta for string schema', () => {
      const schema = Schema.string()
      expect(schema.meta).toBeDefined()
      expect(schema.meta.type).toBe('string')
    })

    it('should have meta for number schema', () => {
      const schema = Schema.number()
      expect(schema.meta).toBeDefined()
      expect(schema.meta.type).toBe('number')
    })

    it('should have meta for boolean schema', () => {
      const schema = Schema.boolean()
      expect(schema.meta).toBeDefined()
      expect(schema.meta.type).toBe('boolean')
    })

    it('should have options for object schema', () => {
      const schema = Schema.object({
        name: Schema.string(),
        age: Schema.number()
      })
      expect(schema.options).toBeDefined()
      expect(schema.options.object).toBeDefined()
    })

    it('should have options for list schema', () => {
      const schema = Schema.list(Schema.string())
      expect(schema.options).toBeDefined()
      expect(schema.options.inner).toBeDefined()
    })
  })

  describe('Schema intersect', () => {
    it('should create intersect schema', () => {
      const schema1 = Schema.object({ name: Schema.string() })
      const schema2 = Schema.object({ age: Schema.number() })
      const intersect = Schema.intersect([schema1, schema2])
      
      expect(intersect).toBeDefined()
      expect(intersect.meta.type).toBe('intersect')
    })
  })
})
