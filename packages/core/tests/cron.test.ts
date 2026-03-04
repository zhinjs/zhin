/**
 * CronFeature 测试（Cron 类测试已迁移到 @zhin.js/kernel）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Cron } from '../src/cron'

describe('CronFeature', () => {
  let feature: import('../src/built/cron.js').CronFeature
  let mockCallback: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.useFakeTimers()
    mockCallback = vi.fn()
    const { CronFeature } = await import('../src/built/cron.js')
    feature = new CronFeature()
  })

  afterEach(() => {
    feature?.dispose()
    vi.useRealTimers()
  })

  it('add 应自动启动任务', () => {
    const cron = new Cron('* * * * * *', mockCallback)
    feature.add(cron, 'test-plugin')
    expect(cron.running).toBe(true)
    expect(feature.items).toHaveLength(1)
  })

  it('add 应返回 dispose 函数', () => {
    const cron = new Cron('* * * * * *', mockCallback)
    const dispose = feature.add(cron, 'test-plugin')
    expect(typeof dispose).toBe('function')
  })

  it('remove 应自动停止任务', () => {
    const cron = new Cron('* * * * * *', mockCallback)
    feature.add(cron, 'test-plugin')
    feature.remove(cron)
    expect(cron.running).toBe(false)
    expect(feature.items).toHaveLength(0)
  })

  it('stopAll 应停止所有任务', () => {
    const cron1 = new Cron('* * * * * *', mockCallback)
    const cron2 = new Cron('*/2 * * * * *', mockCallback)
    feature.add(cron1, 'p1')
    feature.add(cron2, 'p2')
    feature.stopAll()
    expect(cron1.running).toBe(false)
    expect(cron2.running).toBe(false)
  })

  it('startAll 应启动所有已停止的任务', () => {
    const cron1 = new Cron('* * * * * *', mockCallback)
    const cron2 = new Cron('*/2 * * * * *', mockCallback)
    feature.add(cron1, 'p1')
    feature.add(cron2, 'p2')
    feature.stopAll()
    feature.startAll()
    expect(cron1.running).toBe(true)
    expect(cron2.running).toBe(true)
  })

  it('toJSON 应返回正确结构', () => {
    const cron = new Cron('* * * * * *', mockCallback)
    feature.add(cron, 'test-plugin')
    const json = feature.toJSON()
    expect(json.name).toBe('cron')
    expect(json.icon).toBe('Clock')
    expect(json.count).toBe(1)
    expect(json.items[0]).toHaveProperty('expression')
    expect(json.items[0]).toHaveProperty('running', true)
  })

  it('dispose 应停止所有任务', () => {
    const cron = new Cron('* * * * * *', mockCallback)
    feature.add(cron, 'test-plugin')
    feature.dispose()
    expect(cron.running).toBe(false)
  })
})
