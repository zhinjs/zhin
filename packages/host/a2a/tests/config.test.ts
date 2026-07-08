import { describe, it, expect } from 'vitest';
import {
  a2aAgentBasePath,
  a2aAgentCardUrl,
  a2aJsonRpcUrl,
  a2aRestUrl,
  resolvePublicBaseUrl,
} from '../src/config.js';

describe('A2A config URLs', () => {
  it('resolves public base URL from publicUrl, host, and port', () => {
    expect(resolvePublicBaseUrl({ http: { publicUrl: 'https://bot.example.com/' } }))
      .toBe('https://bot.example.com');
    expect(resolvePublicBaseUrl({ http: { host: '0.0.0.0', port: 9000 } }))
      .toBe('http://127.0.0.1:9000');
    expect(resolvePublicBaseUrl({}))
      .toBe('http://127.0.0.1:8086');
  });

  it('builds per-agent A2A endpoint paths', () => {
    const base = 'http://127.0.0.1:8086';
    const agent = 'planner';
    expect(a2aAgentBasePath(agent)).toBe('/a2a/planner');
    expect(a2aJsonRpcUrl(base, agent)).toBe(`${base}/a2a/planner/jsonrpc`);
    expect(a2aRestUrl(base, agent)).toBe(`${base}/a2a/planner/rest`);
    expect(a2aAgentCardUrl(base, agent))
      .toBe(`${base}/a2a/planner/.well-known/agent-card.json`);
  });

  it('encodes agent names in base path', () => {
    expect(a2aAgentBasePath('my agent')).toBe('/a2a/my%20agent');
  });
});
