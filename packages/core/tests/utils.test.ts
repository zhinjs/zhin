import { describe, it, expect } from 'vitest'
import { compiler, evaluate } from '../src/utils'

describe('Template Security', () => {
  it('should prevent access to process object', () => {
    const template = 'Hello ${process}'
    const result = compiler(template, {})
    expect(result).toBe('Hello undefined')
  })

  it('should prevent access to process.env', () => {
    const template = 'Node env: ${process.env.NODE_ENV}'
    const result = compiler(template, {})
    expect(result).toBe('Node env: undefined')
  })

  it('should prevent access to global object', () => {
    const template = 'Global: ${global}'
    const result = compiler(template, {})
    expect(result).toBe('Global: undefined')
  })

  it('should prevent access to require function', () => {
    const template = 'Require: ${require}'
    const result = compiler(template, {})
    expect(result).toBe('Require: undefined')
  })

  it('should allow access to provided context variables', () => {
    const template = 'Hello ${name}!'
    const result = compiler(template, { name: 'World' })
    expect(result).toBe('Hello World!')
  })

  it('should allow complex expressions with safe context', () => {
    const template = 'Result: ${Math.max(1, 2, 3)}'
    const result = compiler(template, {})
    expect(result).toBe('Result: 3')
  })

  it('should handle nested object access safely', () => {
    const template = 'User: ${user.name} (${user.age})'
    const result = compiler(template, { user: { name: 'Alice', age: 25 } })
    expect(result).toBe('User: Alice (25)')
  })

  it('should return template string for unsafe access', () => {
    const result = evaluate('process', {})
    expect(result).toBe('return(process)') // Should return original expression when blocked
  })

  it('should allow safe Math expressions', () => {
    const result = evaluate('Math.PI', {})
    expect(result).toBeCloseTo(3.14159)
  })
})



describe('Template Functionality', () => {
  it('should handle multiple template variables', () => {
    const template = 'Hello ${name}, you are ${age} years old!'
    const result = compiler(template, { name: 'Bob', age: 30 })
    expect(result).toBe('Hello Bob, you are 30 years old!')
  })

  it('should handle JSON objects in templates', () => {
    const template = 'Config: ${config}'
    const config = { debug: true, port: 3000 }
    const result = compiler(template, { config })
    expect(result).toBe(`Config: ${JSON.stringify(config, null, 2)}`)
  })

  it('should handle template expressions that fail gracefully', () => {
    const template = 'Result: ${undefined.property}'
    const result = compiler(template, {})
    // Should return original template when evaluation fails
    expect(result).toBe('Result: ${undefined.property}')
  })
})
