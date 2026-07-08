/**
 * L4 MCP Bearer auth contract.
 */
import { describe, it, expect } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import {
  mcpAuthRequired,
  verifyMcpBearer,
  extractMcpToolName,
} from '../src/mesh-auth.js';

function mockReq(opts: {
  authorization?: string;
  host?: string;
  remoteAddress?: string;
}): IncomingMessage {
  const socket = new Socket();
  if (opts.remoteAddress) {
    Object.defineProperty(socket, 'remoteAddress', { value: opts.remoteAddress });
  }
  return {
    headers: {
      authorization: opts.authorization,
      host: opts.host,
    },
    socket,
  } as IncomingMessage;
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

  it('extractMcpToolName parses JSON-RPC body', () => {
    expect(extractMcpToolName({ params: { name: 'tools/list' } })).toBe('tools/list');
    expect(extractMcpToolName({})).toBeUndefined();
  });
});
