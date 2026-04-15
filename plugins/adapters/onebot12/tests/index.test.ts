import { describe, it, expect } from 'vitest'

describe('Zhin.js adapter for OneBot 12 protocol', () => {
  it('should load adapter module', async () => {
    const mod = await import('../src/index')
    expect(mod).toBeDefined()
    expect(typeof mod).toBe('object')
  })

  it('should have exports', async () => {
    const mod = await import('../src/index')
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })
})
