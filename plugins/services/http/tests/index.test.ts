import { describe, it, expect } from 'vitest'

describe('Service Module', () => {
  it('should load service module', async () => {
    const service = await import('../src/index')
    expect(service).toBeDefined()
    expect(typeof service).toBe('object')
  })

  it('should have exports', async () => {
    const service = await import('../src/index')
    expect(Object.keys(service).length).toBeGreaterThan(0)
  })
})
