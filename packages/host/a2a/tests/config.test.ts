import { describe, it, expect } from 'vitest';
import { a2aAgentCardUrl, a2aJsonRpcUrl, a2aRestUrl } from '../src/config.js';

describe('A2A config URLs', () => {
  it('builds per-agent A2A endpoint paths', () => {
    const base = 'http://127.0.0.1:8086';
    const agent = 'planner';
    expect(a2aJsonRpcUrl(base, agent)).toBe(`${base}/a2a/planner/jsonrpc`);
    expect(a2aRestUrl(base, agent)).toBe(`${base}/a2a/planner/rest`);
    expect(a2aAgentCardUrl(base, agent))
      .toBe(`${base}/a2a/planner/.well-known/agent-card.json`);
  });

  it('encodes agent names in base path', () => {
    expect(a2aRestUrl('', 'my agent')).toBe('/a2a/my%20agent/rest');
  });
});
