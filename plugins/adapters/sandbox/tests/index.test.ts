import { describe, it, expect } from 'vitest'

describe('Sandbox Adapter', () => {
  it('should load adapter module', async () => {
    const sandbox = await import('../src/index')
    expect(sandbox).toBeDefined()
    expect(typeof sandbox).toBe('object')
  })

  it('should have exports', async () => {
    const sandbox = await import('../src/index')
    expect(Object.keys(sandbox).length).toBeGreaterThan(0)
  })
})
