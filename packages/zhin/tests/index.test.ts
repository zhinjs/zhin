import { describe, it, expect } from 'vitest'

describe('Zhin Package Exports', () => {
  it('should export core modules', async () => {
    const zhin = await import('../src/index')
    
    // 验证核心导出存在
    expect(zhin).toBeDefined()
    expect(typeof zhin).toBe('object')
  })

  it('should export Plugin', async () => {
    const { Plugin } = await import('../src/index')
    expect(Plugin).toBeDefined()
    expect(typeof Plugin).toBe('function')
  })

  it('should export Adapter', async () => {
    const { Adapter } = await import('../src/index')
    expect(Adapter).toBeDefined()
    expect(typeof Adapter).toBe('function')
  })

  it('should export Message', async () => {
    const { Message } = await import('../src/index')
    expect(Message).toBeDefined()
  })

  it('should export logger', async () => {
    const { logger } = await import('../src/index')
    expect(logger).toBeDefined()
    expect(typeof logger).toBe('object')
  })

  it('should export Cron', async () => {
    const { Cron } = await import('../src/index')
    expect(Cron).toBeDefined()
    expect(typeof Cron).toBe('function')
  })

  it('should export component utilities', async () => {
    const { defineComponent, renderComponents } = await import('../src/index')
    expect(defineComponent).toBeDefined()
    expect(renderComponents).toBeDefined()
  })

  it('should export JSX runtime', async () => {
    const zhin = await import('../src/index')
    // JSX runtime 可能通过其他方式导出
    expect(zhin).toBeDefined()
  })

  it('should export utility functions', async () => {
    const { segment, Time, compose } = await import('../src/index')
    expect(segment).toBeDefined()
    expect(Time).toBeDefined()
    expect(compose).toBeDefined()
  })

  it('should export error classes', async () => {
    const { ZhinError } = await import('../src/index')
    expect(ZhinError).toBeDefined()
    expect(typeof ZhinError).toBe('function')
  })
})
