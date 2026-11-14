import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyMcpFailure,
  McpConfigurationError,
  McpConnectionError,
  McpSdkMissingError,
  MCP_FAILURE_MESSAGE_LIMIT,
  redactMcpFailureMessage,
} from '../src/mcp-client/failure.js';
import { McpClientConnection } from '../src/mcp-client/connection.js';

describe('MCP connection failure classification (#1250)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('classifies auth, network, timeout, config, process exit and sdk-missing failures', () => {
    expect(classifyMcpFailure(new Error('HTTP 401 Unauthorized')).category).toBe('auth');
    expect(classifyMcpFailure(Object.assign(new Error('x'), { status: 403 })).category).toBe('auth');
    expect(classifyMcpFailure(Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } })).category).toBe('network');
    expect(classifyMcpFailure(new Error('Request timed out')).category).toBe('timeout');
    expect(classifyMcpFailure(new McpConfigurationError('no url')).category).toBe('config');
    expect(classifyMcpFailure(new TypeError('Invalid URL')).category).toBe('config');
    expect(classifyMcpFailure(Object.assign(new Error('spawn mcp-x ENOENT'), { code: 'ENOENT' })).category).toBe('config');
    expect(classifyMcpFailure(new Error('MCP error -32000: Connection closed'), { transport: 'stdio' }, 2))
      .toMatchObject({ category: 'process_exit', exitCode: 2 });
    expect(classifyMcpFailure(new McpSdkMissingError()).category).toBe('sdk_missing');
    expect(classifyMcpFailure(new Error('weird')).category).toBe('unknown');
  });

  it('redacts credentials, query strings, configured header and env values, and bounds the length', () => {
    const entry = { headers: { Authorization: 'Bearer sk-live-secret' }, env: { API_KEY: 'env-secret-value' } };
    const text = redactMcpFailureMessage(
      'failed https://u:p@host.example/mcp?key=q1 with Bearer sk-live-secret token=t0k3n env-secret-value',
      entry,
    );
    for (const secret of ['u:p@', 'key=q1', 'sk-live-secret', 't0k3n', 'env-secret-value']) expect(text).not.toContain(secret);
    expect(text).toContain('https://***@host.example/mcp');
    expect(redactMcpFailureMessage('x'.repeat(500)).length).toBe(MCP_FAILURE_MESSAGE_LIMIT);
  });

  it('redacts token-like URL path segments, stdio arguments and unencoded userinfo of the entry (#1250 review)', () => {
    const pathToken = 'a1B2c3D4e5F6g7H8i9J0kLmN';
    const http = { url: `https://mcp.example.com/v1/${pathToken}/sse`, headers: {}, env: {} };
    const fromPath = redactMcpFailureMessage(`POST https://mcp.example.com/v1/${pathToken}/sse failed: 404 for ${pathToken}`, http);
    expect(fromPath).not.toContain(pathToken);
    // Ordinary path words stay readable.
    expect(fromPath).toContain('https://mcp.example.com/v1/***/sse');

    const stdio = { command: 'npx', args: ['-y', '@example/mcp-server', '--api-key=sk-fake-arg-secret-1', 'ghp_fakePositionalToken42'] };
    const fromArgs = redactMcpFailureMessage(
      'server exited: npx -y @example/mcp-server --api-key=sk-fake-arg-secret-1 ghp_fakePositionalToken42 (invalid key sk-fake-arg-secret-1)',
      stdio,
    );
    for (const secret of ['sk-fake-arg-secret-1', 'ghp_fakePositionalToken42']) expect(fromArgs).not.toContain(secret);
    expect(fromArgs).toContain('server exited: npx -y');

    const userinfo = { url: 'https://bot:pa/ss-fake-word@mcp.example.com/mcp' };
    const fromUserinfo = redactMcpFailureMessage('connect to https://bot:pa/ss-fake-word@mcp.example.com/mcp refused; user bot:pa/ss-fake-word', userinfo);
    expect(fromUserinfo).not.toContain('pa/ss-fake-word');
    expect(fromUserinfo).toContain('mcp.example.com/mcp');
    // Even without the entry, `scheme://user:pass/with/slash@host` loses its credentials.
    expect(redactMcpFailureMessage('GET https://u:p/w-fake@h.example/x failed')).toBe('GET https://***@h.example/x failed');
  });

  it('a connection without url fails as config and keeps the reason after the failed attempt', async () => {
    // Stub the optional SDK so the test does not depend on it being resolvable.
    vi.spyOn(McpClientConnection.prototype as unknown as { loadSdk(): Promise<unknown> }, 'loadSdk')
      .mockResolvedValue({ Client: class { async connect() {} async close() {} } });
    const connection = new McpClientConnection({ name: 'remote', transport: 'sse' });
    const error = await connection.connect().then(() => undefined, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(McpConnectionError);
    expect(connection.isConnected).toBe(false);
    expect(connection.failure).toMatchObject({ category: 'config' });
    expect((error as McpConnectionError).failure.category).toBe('config');
    expect(connection.failure?.message).toContain('has no url');
  });

  it('reports a missing SDK as sdk_missing without throwing', async () => {
    vi.spyOn(McpClientConnection.prototype as unknown as { loadSdk(): Promise<unknown> }, 'loadSdk').mockResolvedValue(null);
    const connection = new McpClientConnection({ name: 'local', transport: 'stdio', command: 'x' });
    await expect(connection.connect()).resolves.toMatchObject({ connected: false });
    expect(connection.failure).toMatchObject({ category: 'sdk_missing' });
  });
});
