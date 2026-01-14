import { describe, it, expect } from 'vitest'

describe('DingTalk Adapter', () => {
  it('should load adapter module', async () => {
    const dingtalk = await import('../src/index')
    expect(dingtalk).toBeDefined()
    expect(typeof dingtalk).toBe('object')
  })

  it('should have exports', async () => {
    const dingtalk = await import('../src/index')
    expect(Object.keys(dingtalk).length).toBeGreaterThan(0)
  })
})
