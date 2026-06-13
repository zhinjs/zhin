import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture process.exit calls instead of actually calling
let exitCode: number | undefined
const exitCalls: number[] = []
vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
  exitCalls.push(code ?? 0)
  exitCode = code
  return undefined as never
}) as any)

vi.spyOn(process, 'kill').mockImplementation(() => true as any)

vi.mock('@zhin.js/agent/task-executor', () => ({
  drainTaskExecutorLocks: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@zhin.js/host-api', () => ({
  stopSseHub: vi.fn(),
}))

async function importShutdown() {
  vi.resetModules()
  // Re-mock after resetModules
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCalls.push(code ?? 0)
    exitCode = code
    return undefined as never
  }) as any)
  vi.spyOn(process, 'kill').mockImplementation(() => true as any)
  vi.doMock('@zhin.js/agent/task-executor', () => ({
    drainTaskExecutorLocks: vi.fn().mockResolvedValue(undefined),
  }))
  vi.doMock('@zhin.js/host-api', () => ({
    stopSseHub: vi.fn(),
  }))
  return import('../src/shutdown.js')
}

function mockPlugin(overrides?: { stopFn?: () => Promise<void> }) {
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    stop: overrides?.stopFn ?? vi.fn().mockResolvedValue(undefined),
  } as any
}

describe('gracefulShutdown', () => {
  beforeEach(() => {
    exitCalls.length = 0
    exitCode = undefined
  })

  it('should exit with code 0 on clean shutdown (default)', async () => {
    const { gracefulShutdown } = await importShutdown()
    await gracefulShutdown('SIGTERM', { plugin: mockPlugin() })
    expect(exitCalls).toContain(0)
  })

  it('should exit with specified exitCode', async () => {
    const { gracefulShutdown } = await importShutdown()
    await gracefulShutdown('uncaughtException', { plugin: mockPlugin(), exitCode: 1 })
    expect(exitCalls).toContain(1)
  })

  it('should exit with code 1 when plugin.stop() throws', async () => {
    const { gracefulShutdown } = await importShutdown()
    const plugin = mockPlugin({ stopFn: vi.fn().mockRejectedValue(new Error('stop failed')) })
    await gracefulShutdown('SIGTERM', { plugin })
    expect(exitCalls).toContain(1)
    expect(plugin.logger.error).toHaveBeenCalled()
  })

  it('should upgrade exitCode to 1 on shutdown error even when exitCode was 0', async () => {
    const { gracefulShutdown } = await importShutdown()
    const plugin = mockPlugin({ stopFn: vi.fn().mockRejectedValue(new Error('cleanup')) })
    await gracefulShutdown('SIGTERM', { plugin, exitCode: 0 })
    expect(exitCalls).toContain(1)
  })

  it('should preserve caller exitCode when shutdown succeeds', async () => {
    const { gracefulShutdown } = await importShutdown()
    await gracefulShutdown('uncaughtException', { plugin: mockPlugin(), exitCode: 1 })
    expect(exitCalls).toContain(1)
  })
})
