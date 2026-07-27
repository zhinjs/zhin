import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Plugin } from '@zhin.js/core';
import { registerSpeech } from '../src/setup/register-speech.js';
import { registerHtmlRenderer } from '../src/setup/register-html-renderer.js';
import type { AppConfig } from '../src/types.js';

const mocks = vi.hoisted(() => ({
  speechError: null as (Error & { code?: string }) | null,
  rendererError: null as (Error & { code?: string }) | null,
}));

vi.mock('@zhin.js/speech', () => ({
  // getter 抛错模拟动态 import 失败：错误原样穿过，code 保留
  get createSpeechPipeline() {
    if (mocks.speechError) throw mocks.speechError;
    return () => ({});
  },
}));

vi.mock('@zhin.js/html-renderer', () => ({
  get createHtmlRenderer() {
    if (mocks.rendererError) throw mocks.rendererError;
    return () => ({});
  },
  get registerAiTextAsImageOutput() {
    if (mocks.rendererError) throw mocks.rendererError;
    return () => null;
  },
}));

function fakePlugin() {
  return {
    logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
    onDispose: vi.fn(),
    root: {},
  } as unknown as Plugin & { logger: { warn: ReturnType<typeof vi.fn> } };
}

describe('registerSpeech / registerHtmlRenderer 错误处理', () => {
  beforeEach(() => {
    mocks.speechError = null;
    mocks.rendererError = null;
  });

  it('ERR_MODULE_NOT_FOUND 时警告并跳过（speech）', async () => {
    const err = new Error('Cannot find module') as Error & { code: string };
    err.code = 'ERR_MODULE_NOT_FOUND';
    mocks.speechError = err;

    const plugin = fakePlugin();
    await expect(registerSpeech(plugin, {} as AppConfig)).resolves.toBeUndefined();
    expect(plugin.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('未安装 @zhin.js/speech'),
    );
  });

  it('非「未安装」错误原样抛出（speech）', async () => {
    mocks.speechError = new Error('boom: broken init');

    const plugin = fakePlugin();
    await expect(registerSpeech(plugin, {} as AppConfig)).rejects.toThrow('boom: broken init');
    expect(plugin.logger.warn).not.toHaveBeenCalled();
  });

  it('ERR_MODULE_NOT_FOUND 时警告并跳过（html-renderer）', async () => {
    const err = new Error('Cannot find module') as Error & { code: string };
    err.code = 'ERR_MODULE_NOT_FOUND';
    mocks.rendererError = err;

    const plugin = fakePlugin();
    await expect(registerHtmlRenderer(plugin, {} as AppConfig)).resolves.toBeUndefined();
    expect(plugin.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('未安装 @zhin.js/html-renderer'),
    );
  });

  it('非「未安装」错误原样抛出（html-renderer）', async () => {
    mocks.rendererError = new Error('boom: bad config');

    const plugin = fakePlugin();
    await expect(registerHtmlRenderer(plugin, {} as AppConfig)).rejects.toThrow('boom: bad config');
    expect(plugin.logger.warn).not.toHaveBeenCalled();
  });
});
