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

  it('应导出 NapCatEndpointBase', async () => {
    const mod = await import('../src/endpoint-base');
    expect(mod.NapCatEndpointBase).toBeDefined();
    expect(typeof mod.NapCatEndpointBase).toBe('function');
  });

  it('应导出 NapCatWsClient', async () => {
    const mod = await import('../src/endpoint-ws-client');
    expect(mod.NapCatWsClient).toBeDefined();
  });

  it('应导出 NapCatWsServer', async () => {
    const mod = await import('../src/endpoint-ws-server');
    expect(mod.NapCatWsServer).toBeDefined();
  });

  it('应导出 NapCatHttpEndpoint', async () => {
    const mod = await import('../src/endpoint-http');
    expect(mod.NapCatHttpEndpoint).toBeDefined();
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

  it('应导出 agent-prompt', async () => {
    const mod = await import('../src/agent-prompt');
    expect(mod.createNapCatAgentPromptContributor).toBeDefined();
  });
});
