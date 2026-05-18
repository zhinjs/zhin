import { describe, it, expect } from 'vitest';
import type { AgentTool } from '@zhin.js/ai';
import { selectDeferredToolsForWorker } from '../src/deferred-worker-tool-load.js';

function t(name: string, desc = name): AgentTool {
  return {
    name,
    description: desc,
    parameters: { type: 'object', properties: {} },
    execute: async () => name,
  };
}

describe('deferred-worker-tool-load default', () => {
  const catalog = [
    t('weather'),
    t('icqq_send_user_like', 'like friend'),
    t('mcp_icqq_icqq_invoke', 'icqq ipc'),
  ];

  it('uses TF-IDF filterTools for generic queries', () => {
    const loaded = selectDeferredToolsForWorker('weather', '成都天气', catalog, 3);
    expect(loaded.length).toBeGreaterThan(0);
    expect(loaded[0].name).toBe('weather');
  });
});
