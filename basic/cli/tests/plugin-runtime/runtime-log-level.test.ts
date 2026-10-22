import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLevel, LogLevel, setLevel } from '@zhin.js/logger';
import { applyRuntimeLogLevel } from '../../src/plugin-runtime/start-command.js';

describe('applyRuntimeLogLevel', () => {
  const initial = getLevel();
  afterEach(() => {
    vi.unstubAllEnvs();
    setLevel(initial, undefined, true);
  });

  it('honours ZHIN_LOG_LEVEL even when the config sets no log_level', async () => {
    setLevel('info', undefined, true);
    vi.stubEnv('ZHIN_LOG_LEVEL', 'debug');
    await applyRuntimeLogLevel({} as never);
    expect(getLevel()).toBe(LogLevel.DEBUG);
  });

  it('lets the environment override config and falls back to config otherwise', async () => {
    vi.stubEnv('ZHIN_LOG_LEVEL', '');
    vi.stubEnv('LOG_LEVEL', '');
    await applyRuntimeLogLevel({ log_level: 'warn' } as never);
    expect(getLevel()).toBe(LogLevel.WARN);
    vi.stubEnv('LOG_LEVEL', 'debug');
    await applyRuntimeLogLevel({ log_level: 'warn' } as never);
    expect(getLevel()).toBe(LogLevel.DEBUG);
  });

  it('leaves the level alone when neither sets one', async () => {
    setLevel('info', undefined, true);
    vi.stubEnv('ZHIN_LOG_LEVEL', '');
    vi.stubEnv('LOG_LEVEL', '');
    await applyRuntimeLogLevel({} as never);
    expect(getLevel()).toBe(LogLevel.INFO);
  });
});
