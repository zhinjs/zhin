import { describe, it, expect, vi } from 'vitest'

// 加载 http 插件时会调用 usePlugin().declareConfig 等，测试环境无 Zhin 应用，需 mock
vi.mock('zhin.js', () => ({
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
  DatabaseFeature: vi.fn(),
  Models: vi.fn(),
  Adapter: vi.fn(),
  SystemLog: vi.fn(),
  Plugin: vi.fn(),
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
