import { describe, it, expect } from 'vitest'

describe('Adapter Module', () => {
  it('should load adapter module', async () => {
    const adapter = await import('../src/index')
    expect(adapter).toBeDefined()
    expect(typeof adapter).toBe('object')
  })

  it('should have exports', async () => {
    const adapter = await import('../src/index')
    expect(Object.keys(adapter).length).toBeGreaterThan(0)
  })
})
