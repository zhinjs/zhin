import { describe, it, expect } from 'vitest'

describe('WeCom Adapter', () => {
  it('should load adapter module', async () => {
    const wecom = await import('../src/index')
    expect(wecom).toBeDefined()
    expect(typeof wecom).toBe('object')
  })

  it('should have exports', async () => {
    const wecom = await import('../src/index')
    expect(Object.keys(wecom).length).toBeGreaterThan(0)
  })
})
