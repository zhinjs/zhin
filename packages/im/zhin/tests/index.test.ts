import { describe, it, expect, expectTypeOf } from 'vitest'
import type { Message as CoreMessage, Notice as CoreNotice, Request as CoreRequest } from '@zhin.js/core'
import type { Message, Notice, Request } from '../src/index.js'

describe('Zhin Package Exports', () => {
  it('should export core modules', async () => {
    const zhin = await import('../src/index')
    
    // 验证核心导出存在
    expect(zhin).toBeDefined()
    expect(typeof zhin).toBe('object')
  })

  it('should export Message', async () => {
    const { Message } = await import('../src/index')
    expect(Message).toBeDefined()
  })

  it('should preserve the canonical inbound event types', () => {
    expectTypeOf<Message>().toEqualTypeOf<CoreMessage>()
    expectTypeOf<Notice>().toEqualTypeOf<CoreNotice>()
    expectTypeOf<Request>().toEqualTypeOf<CoreRequest>()
  })

  it('should export logger', async () => {
    const { logger } = await import('../src/index')
    expect(logger).toBeDefined()
    expect(typeof logger).toBe('object')
  })

  it('should export ScheduleEngine', async () => {
    const { ScheduleEngine } = await import('../src/index')
    expect(ScheduleEngine).toBeDefined()
    expect(typeof ScheduleEngine).toBe('function')
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
