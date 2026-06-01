/**
 * NapCat 适配器模块加载与导出测试
 */
import { describe, it, expect } from 'vitest';

describe('NapCat 适配器模块导出', () => {
  it('应导出 NapCatAdapter', async () => {
    const mod = await import('../src/adapter');
    expect(mod.NapCatAdapter).toBeDefined();
    expect(typeof mod.NapCatAdapter).toBe('function');
  });

  it('应导出 NapCatBotBase', async () => {
    const mod = await import('../src/bot-base');
    expect(mod.NapCatBotBase).toBeDefined();
    expect(typeof mod.NapCatBotBase).toBe('function');
  });

  it('应导出 NapCatWsClient', async () => {
    const mod = await import('../src/bot-ws-client');
    expect(mod.NapCatWsClient).toBeDefined();
  });

  it('应导出 NapCatWsServer', async () => {
    const mod = await import('../src/bot-ws-server');
    expect(mod.NapCatWsServer).toBeDefined();
  });

  it('应导出 NapCatHttpBot', async () => {
    const mod = await import('../src/bot-http');
    expect(mod.NapCatHttpBot).toBeDefined();
  });

  it('应导出 createNapCatTools', async () => {
    const mod = await import('../src/tools');
    expect(mod.createNapCatTools).toBeDefined();
    expect(typeof mod.createNapCatTools).toBe('function');
  });

  it('应导出入站模块', async () => {
    const mod = await import('../src/napcat-inbound');
    expect(mod.InboundMessageDeduper).toBeDefined();
    expect(mod.isSelfMessage).toBeDefined();
    expect(mod.normalizeMessage).toBeDefined();
  });

  it('应导出 typing-indicator', async () => {
    const mod = await import('../src/typing-indicator');
    expect(mod.NapCatTypingIndicatorManager).toBeDefined();
    expect(mod.enableTypingIndicator).toBeDefined();
  });

  it('应导出 agent-prompt', async () => {
    const mod = await import('../src/agent-prompt');
    expect(mod.createNapCatAgentPromptContributor).toBeDefined();
  });
});
