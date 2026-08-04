import { describe, expect, it } from 'vitest';
import { createInboundTurnPipeline, normalizeContentPartsToPayloads } from '../src/index.js';
import { ZhinAgent } from '../src/zhin-agent/index.js';

describe('public compatibility exports', () => {
  it('keeps the migrated inbound and multimodal entry points available', () => {
    expect(typeof createInboundTurnPipeline).toBe('function');
    expect(typeof normalizeContentPartsToPayloads).toBe('function');
    expect(typeof ZhinAgent.prototype.processMultimodal).toBe('function');
  });
});
