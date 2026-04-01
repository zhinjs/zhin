import { describe, it, expect } from 'vitest'

describe('进程监控与重启通知插件', () => {
  it('should load feature module', async () => {
    const mod = await import('../src/index')
    expect(mod).toBeDefined()
    expect(typeof mod).toBe('object')
  })

  it('should have exports', async () => {
    const mod = await import('../src/index')
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
})
