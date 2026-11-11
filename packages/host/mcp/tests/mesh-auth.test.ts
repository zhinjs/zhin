/**
 * L4 MCP Bearer auth contract.
 */
import { describe, it, expect } from 'vitest';
import {
  mcpAuthRequired,
  verifyMcpBearer,
  type McpAuthRequest,
} from '../src/mesh-auth.js';

function mockReq(opts: {
  authorization?: string;
  host?: string;
  remoteAddress?: string;
}): McpAuthRequest {
  const headers = new Headers();
  if (opts.authorization) headers.set('authorization', opts.authorization);
  if (opts.host) headers.set('host', opts.host);
  return { headers, ...(opts.remoteAddress ? { remoteAddress: opts.remoteAddress } : {}) };
}

describe('MCP auth', () => {
  it('requires auth in production', () => {
    const body = { params: { name: 'some_tool' } };
    const req = mockReq({ host: 'localhost:8068', remoteAddress: '127.0.0.1' });
    expect(mcpAuthRequired(body, req, {}, true)).toBe(true);
  });

  it('allows localhost in dev when configured', () => {
    const body = { params: { name: 'some_other_tool' } };
    const req = mockReq({ host: 'localhost:8068', remoteAddress: '127.0.0.1' });
    expect(mcpAuthRequired(body, req, {}, false)).toBe(false);
  });

  it('verifyMcpBearer rejects missing or wrong token', () => {
    const req = mockReq({ authorization: 'Bearer wrong' });
    expect(verifyMcpBearer(req, 'secret')).toBe(false);
    expect(verifyMcpBearer(mockReq({}), 'secret')).toBe(false);
  });

  it('verifyMcpBearer accepts matching Bearer token', () => {
    const req = mockReq({ authorization: 'Bearer my-token' });
    expect(verifyMcpBearer(req, 'my-token')).toBe(true);
  });
});
