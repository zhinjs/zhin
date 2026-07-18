import { describe, expect, it, beforeEach } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import { parseMiddlewareDefinition } from '@zhin.js/middleware';
import plugin from '../plugin.ts';
import middleware from '../middlewares/repeater.ts';
import statusCommand from '../commands/repeater-status.ts';
import {
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
      target: 'g1',
      content: 'hi',
      metadata: { type: 'group' },
    })).toBe('g1');
    expect(resolveGroupId({
      target: 'u1',
      content: 'hi',
      metadata: { type: 'private' },
    })).toBeNull();
  });

  it('repeats after threshold distinct senders', () => {
    const engine = new RepeaterEngine();
    const config = resolveRepeaterConfig({ threshold: 3, cooldown: 1000, maxLength: 200 });
    const base = { target: 'g1', content: 'echo', metadata: { type: 'group' as const } };

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
    const base = { target: 'g1', content: 'echo', metadata: { type: 'group' as const } };
    expect(engine.tick({ ...base, sender: 'a' }, config).action).toBe('next');
    expect(engine.tick({ ...base, sender: 'a' }, config).action).toBe('next');
    expect(engine.tick({ ...base, sender: 'b' }, config).action).toBe('repeat');
    engine.dispose();
  });
});
