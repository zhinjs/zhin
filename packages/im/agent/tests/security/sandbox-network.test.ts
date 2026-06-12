/**
 * Sandbox 网络命令阻断测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Sandbox } from '../../src/security/sandbox.js';

describe('Sandbox Network Blocking', () => {
  let sandbox: Sandbox;

  beforeEach(() => {
    sandbox = new Sandbox({
      enabled: true,
      enableNetwork: false,
    });
  });

  it('should block curl when network disabled', async () => {
    const result = await sandbox.execute('curl http://example.com');
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain('网络未启用');
  });

  it('should block wget when network disabled', async () => {
    const result = await sandbox.execute('wget http://example.com');
    expect(result.blocked).toBe(true);
  });

  it('should block ssh when network disabled', async () => {
    const result = await sandbox.execute('ssh user@host');
    expect(result.blocked).toBe(true);
  });

  it('should block ping when network disabled', async () => {
    const result = await sandbox.execute('ping 8.8.8.8');
    expect(result.blocked).toBe(true);
  });

  it('should allow non-network commands when network disabled', async () => {
    const result = await sandbox.execute('echo hello');
    expect(result.blocked).toBe(false);
    expect(result.stdout.trim()).toBe('hello');
  });

  it('should allow network commands when network enabled', async () => {
    sandbox.updateConfig({ enableNetwork: true });
    const result = await sandbox.execute('curl --version');
    expect(result.blocked).toBe(false);
  });

  it('should validate domains when allowedDomains set', async () => {
    sandbox.updateConfig({
      enableNetwork: true,
      allowedDomains: ['example.com'],
    });

    // Blocked domain - should be blocked
    const result = await sandbox.execute('curl http://evil.com/steal');
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain('不在允许列表中');
  });
});
