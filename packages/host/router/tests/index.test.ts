import { describe, it, expect, vi } from 'vitest'

// 加载 host-router 时会调用 usePlugin().declareConfig 等，测试环境无 Zhin 应用，需 mock
vi.mock('@zhin.js/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@zhin.js/core')>()),
  usePlugin: () => ({
    declareConfig: vi.fn(),
    provide: vi.fn(),
    root: {
      inject: vi.fn(() => null),
      adapters: [],
      children: [],
    },
    useContext: vi.fn(), // 不执行回调，避免 server.listen 等副作用
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  }),
  formatCompact: (v: unknown) => String(v),
}))

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
