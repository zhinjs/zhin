/**
 * 适配器集成测试工具箱自测
 */
import { createAdapterTestSuite, HarnessTestAdapter } from './adapter-harness';

// ── 1. Harness 自测：用 HarnessTestAdapter 验证 harness 本身 ──

createAdapterTestSuite({
  adapterName: 'harness-test',
  endpointKey: 'bot-1',
  createAdapter: (plugin) =>
    new HarnessTestAdapter(plugin, 'harness-test' as any, [{ id: 'bot-1' }]),
  createRawEvent: () => ({
    id: `msg-${Date.now()}`,
    text: '你好，世界',
    from: 'user-1',
  }),
});
