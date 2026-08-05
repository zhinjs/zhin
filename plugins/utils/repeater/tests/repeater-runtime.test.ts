import { describe, expect, it, beforeEach, vi } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import { parseMiddlewareDefinition } from '@zhin.js/middleware';
import plugin from '../plugin.ts';
import middleware from '../middlewares/repeater.ts';
import statusCommand from '../commands/repeater-status.ts';
import {
  getRepeaterEngine,
  RepeaterEngine,
  resetRepeaterEngine,
  resolveGroupId,
  resolveRepeaterConfig,
} from '../src/engine.js';

describe('@zhin.js/plugin-repeater', () => {
  beforeEach(() => {
    resetRepeaterEngine();
  });

  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('repeater');
  });

  it('brands middleware and status command', () => {
    expect(parseMiddlewareDefinition(middleware)).toBe(middleware);
    expect(parseCommandDefinition(statusCommand)).toBe(statusCommand);
  });

  it('resolves group id from metadata with private skip', () => {
    expect(resolveGroupId({
      conversation: { kind: 'group', id: 'g1' },
      content: 'hi',
      metadata: { type: 'group' },
    })).toBe('g1');
    expect(resolveGroupId({
      conversation: { kind: 'private', id: 'u1' },
      content: 'hi',
      metadata: { type: 'private' },
    })).toBeNull();
  });

  it('repeats after threshold distinct senders', () => {
    const engine = new RepeaterEngine();
    const config = resolveRepeaterConfig({ threshold: 3, cooldown: 1000, maxLength: 200 });
    const base = { conversation: { kind: 'group' as const, id: 'g1' }, content: 'echo', metadata: { type: 'group' as const } };

    expect(engine.tick({ ...base, sender: 'a' }, config).action).toBe('next');
    expect(engine.tick({ ...base, sender: 'b' }, config).action).toBe('next');
    expect(engine.tick({ ...base, sender: 'c' }, config)).toEqual({
      action: 'repeat',
      content: 'echo',
    });
    expect(engine.totalRepeats).toBe(1);
    engine.dispose();
  });

  it('ignores same sender double-post', () => {
    const engine = new RepeaterEngine();
    const config = resolveRepeaterConfig({ threshold: 2 });
    const base = { conversation: { kind: 'group' as const, id: 'g1' }, content: 'echo', metadata: { type: 'group' as const } };
    expect(engine.tick({ ...base, sender: 'a' }, config).action).toBe('next');
    expect(engine.tick({ ...base, sender: 'a' }, config).action).toBe('next');
    expect(engine.tick({ ...base, sender: 'b' }, config).action).toBe('repeat');
    engine.dispose();
  });

  it('drops the shared singleton when disposed', () => {
    const first = getRepeaterEngine();
    expect(getRepeaterEngine()).toBe(first);
    first.dispose();
    const second = getRepeaterEngine();
    expect(second).not.toBe(first);
  });

  it('prunes cooldown entries by configured cooldown, not the default', () => {
    vi.useFakeTimers();
    try {
      const t0 = Date.now();
      const engine = new RepeaterEngine();
      const config = resolveRepeaterConfig({ threshold: 2, cooldown: 300_000 });
      const base = { conversation: { kind: 'group' as const, id: 'g1' }, metadata: { type: 'group' as const } };
      expect(engine.tick({ ...base, content: 'echo', sender: 'a' }, config).action).toBe('next');
      expect(engine.tick({ ...base, content: 'echo', sender: 'b' }, config).action).toBe('repeat');

      // 120s 后：默认 30s 冷却（30s*2=60s）会清掉冷却记录，配置 300s（*2=600s）必须保留
      vi.setSystemTime(t0 + 120_000);
      engine.pruneStale();

      expect(engine.tick({ ...base, content: 'other', sender: 'a' }, config).action).toBe('next');
      // 冷却仍在：达到阈值也不得复读
      expect(engine.tick({ ...base, content: 'other', sender: 'b' }, config).action).toBe('next');
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
