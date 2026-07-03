/**
 * ScheduleFeature 测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('ScheduleFeature', () => {
  let feature: import('../src/built/schedule.js').ScheduleFeature;
  let mockCallback: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    mockCallback = vi.fn();
    const { ScheduleFeature } = await import('../src/built/schedule.js');
    feature = new ScheduleFeature();
  });

  afterEach(() => {
    feature?.dispose();
    vi.useRealTimers();
  });

  it('add 应注册内存任务 handle', () => {
    const dispose = vi.fn();
    feature.add(
      { id: 'test-job', descriptor: { kind: 'every', everyMs: 1000 }, dispose },
      'test-plugin',
    );
    expect(feature.items).toHaveLength(1);
    expect(dispose).not.toHaveBeenCalled();
  });

  it('remove 应注销任务', () => {
    const handle = { id: 'h1', descriptor: { kind: 'solar' as const, cron: '0 0 12 * * *' }, dispose: vi.fn() };
    feature.add(handle, 'test-plugin');
    feature.remove(handle);
    expect(handle.dispose).toHaveBeenCalled();
    expect(feature.items).toHaveLength(0);
  });

  it('stopAll 应 dispose 所有任务', () => {
    const dispose1 = vi.fn();
    const dispose2 = vi.fn();
    feature.add(
      { id: 'a', descriptor: { kind: 'solar', cron: '0 0 9 * * *' }, dispose: dispose1 },
      'p1',
    );
    feature.add(
      { id: 'b', descriptor: { kind: 'solar', cron: '0 0 10 * * *' }, dispose: dispose2 },
      'p2',
    );
    feature.stopAll();
    expect(dispose1).toHaveBeenCalled();
    expect(dispose2).toHaveBeenCalled();
  });

  it('toJSON 应返回正确结构', () => {
    feature.add(
      { id: 'j1', descriptor: { kind: 'solar', cron: '0 0 8 * * *' }, dispose: vi.fn() },
      'test-plugin',
    );
    const json = feature.toJSON();
    expect(json.name).toBe('schedule');
    expect(json.icon).toBe('Clock');
    expect(json.count).toBe(1);
    expect(json.items[0]).toHaveProperty('kind', 'solar');
  });

  it('dispose 应停止所有任务', () => {
    const dispose = vi.fn();
    feature.add(
      { id: 'j1', descriptor: { kind: 'every', everyMs: 5000 }, dispose },
      'test-plugin',
    );
    feature.dispose();
    expect(dispose).toHaveBeenCalled();
  });
});
