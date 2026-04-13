/**
 * 适配器集成测试工具箱自测 + ProcessAdapter 集成测试
 */
import { describe } from 'vitest';
import { Plugin } from '../src/plugin';
import { createAdapterTestSuite, HarnessTestAdapter } from './adapter-harness';
import { ProcessAdapter } from '../src/built/adapter-process';

// ── 1. Harness 自测：用 HarnessTestAdapter 验证 harness 本身 ──

createAdapterTestSuite({
  adapterName: 'harness-test',
  botId: 'bot-1',
  createAdapter: (plugin) =>
    new HarnessTestAdapter(plugin, 'harness-test' as any, [{ name: 'bot-1' }]),
  createRawEvent: () => ({
    id: `msg-${Date.now()}`,
    text: '你好，世界',
    from: 'user-1',
  }),
});

// ── 2. ProcessAdapter 集成测试 ──

createAdapterTestSuite({
  adapterName: 'process',
  botId: `${process.pid}`,
  createAdapter: (plugin) => new ProcessAdapter(plugin),
  createRawEvent: () => ({
    content: 'hello from test',
    ts: Date.now(),
  }),
  setupBot: (bot) => {
    // ProcessBot.$connect 会绑定 stdin listener，测试中 stub 掉避免副作用
    // 但 start() 已经调了 $connect，所以这里只确保 $sendMessage 不依赖真实 IO
  },
});
