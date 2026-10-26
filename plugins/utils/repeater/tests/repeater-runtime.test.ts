import { describe, expect, it, vi } from 'vitest';
import schema from '../schema.json' with { type: 'json' };
import Ajv2020 from 'ajv/dist/2020.js';
import { parseCommandDefinition } from 'zhin.js/command';
import { parseMiddlewareDefinition } from '@zhin.js/middleware';
import plugin from '../plugin.ts';
import middleware from '../middlewares/repeater/index.ts';
import statusCommand from '../commands/repeater-status/index.ts';
import {
  DEFAULT_REPEATER_CONFIG,
  RepeaterEngine,
  resolveGroupId,
} from '../src/engine.js';
import { repeaterEngineToken } from '../src/runtime.js';

describe('@zhin.js/plugin-repeater', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('repeater');
  });

  it('validates and defaults the same configuration exposed to Console', () => {
    const ajv = new Ajv2020({ useDefaults: true, strict: true });
    ajv.addKeyword({ keyword: 'x-zhin-config', schemaType: 'object' });
    ajv.addKeyword({ keyword: 'x-i18n', schemaType: 'object' });
    const validate = ajv.compile(schema);
    const empty = {};
    expect(validate(empty)).toBe(true);
    expect(empty).toEqual(DEFAULT_REPEATER_CONFIG);
    expect(validate({ threshold: 1 })).toBe(false);
    expect(validate({ threshold: 2.5 })).toBe(false);
    expect(validate({ maxLength: 20.5 })).toBe(false);
    expect(validate({ threshold: '3' })).toBe(false);
    expect(validate({ unknown: true })).toBe(false);
    expect(schema).toMatchObject({
      properties: { threshold: { default: 3, 'x-zhin-config': { effect: 'reload' } } },
    });
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
    const config = { ...DEFAULT_REPEATER_CONFIG, threshold: 3, cooldown: 5000, maxLength: 200 };
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
    const config = { ...DEFAULT_REPEATER_CONFIG, threshold: 2 };
    const base = { conversation: { kind: 'group' as const, id: 'g1' }, content: 'echo', metadata: { type: 'group' as const } };
    expect(engine.tick({ ...base, sender: 'a' }, config).action).toBe('next');
    expect(engine.tick({ ...base, sender: 'a' }, config).action).toBe('next');
    expect(engine.tick({ ...base, sender: 'b' }, config).action).toBe('repeat');
    engine.dispose();
  });

  it('keeps engine state isolated between runtime owners', () => {
    const first = new RepeaterEngine();
    const second = new RepeaterEngine();
    const config = { ...DEFAULT_REPEATER_CONFIG, threshold: 2 };
    const base = { conversation: { kind: 'group' as const, id: 'g1' }, content: 'echo' };
    first.tick({ ...base, sender: 'a' }, config);
    first.tick({ ...base, sender: 'b' }, config);

    expect(first.totalRepeats).toBe(1);
    expect(second.totalRepeats).toBe(0);
    first.dispose();
    second.dispose();
  });

  it('middleware wires runtime Message conversation into the engine (regression)', async () => {
    // 回归：中间件曾传 `{ target, ... }`（无 conversation），resolveGroupId 逐条抛
    // TypeError，复读在生产完全失效。这里用 runtime Message 形直接驱动 handle。
    const replies: unknown[] = [];
    const next = vi.fn(async () => {});
    const handle = middleware.handle;
    const engine = new RepeaterEngine();
    const makeContext = (senderId: string, kind: 'group' | 'private' = 'group') => ({
      input: {
        conversation: {
          endpoint: { id: 'sandbox\0im\0bot', adapter: 'sandbox' },
          kind,
          id: kind === 'group' ? 'g1' : senderId,
        },
        content: 'echo',
        sender: { id: senderId, name: senderId },
        metadata: Object.freeze({}),
        $reply: async (content: unknown) => {
          replies.push(content);
        },
      },
      config: { threshold: 3, cooldown: 5_000, maxLength: 200 },
      use: (token: unknown) => {
        expect(token).toBe(repeaterEngineToken);
        return engine;
      },
    }) as unknown as Parameters<typeof handle>[0];

    await handle(makeContext('a'), next);
    await handle(makeContext('b'), next);
    expect(replies).toEqual([]);
    expect(next).toHaveBeenCalledTimes(2);

    // 第三个不同 sender 同文 → 复读一次且不再放行
    await handle(makeContext('c'), next);
    expect(replies).toEqual(['echo']);
    expect(next).toHaveBeenCalledTimes(2);

    // 私聊直接放行
    await handle(makeContext('d', 'private'), next);
    expect(next).toHaveBeenCalledTimes(3);
    expect(replies).toEqual(['echo']);
    engine.dispose();
  });

  it('prunes cooldown entries by configured cooldown, not the default', () => {
    vi.useFakeTimers();
    try {
      const t0 = Date.now();
      const engine = new RepeaterEngine();
      const config = { ...DEFAULT_REPEATER_CONFIG, threshold: 2, cooldown: 300_000 };
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
