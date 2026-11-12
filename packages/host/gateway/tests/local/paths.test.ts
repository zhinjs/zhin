import { describe, expect, it } from 'vitest';
import { gatewaySocketPath, isNamedPipe, projectRootHash, windowsPipeName } from '../../src/local/paths.js';

describe('gateway local endpoint paths', () => {
  it('derives a stable Windows pipe name from the project root, case-insensitively', () => {
    const name = windowsPipeName('C:\\Users\\me\\bot');
    expect(name).toMatch(/^\\\\\.\\pipe\\zhin-gateway-[0-9a-f]{16}$/u);
    expect(windowsPipeName('c:\\users\\ME\\bot')).toBe(name);
    expect(windowsPipeName('C:\\Users\\me\\bot\\')).toBe(name);
    expect(windowsPipeName('C:\\Users\\me\\other')).not.toBe(name);
    expect(gatewaySocketPath('C:\\Users\\me\\bot', { platform: 'win32' })).toBe(name);
    expect(isNamedPipe(name)).toBe(true);
    // A running gateway adds a random component per start (Node cannot set a pipe DACL).
    const running = gatewaySocketPath('C:\\Users\\me\\bot', { platform: 'win32', nonce: 'a1b2c3d4' });
    expect(running).toBe(`${name}-a1b2c3d4`);
    expect(isNamedPipe(running)).toBe(true);
  });

  it('uses .zhin/gateway.sock on Unix, and a hashed temp path when that is too long', () => {
    expect(gatewaySocketPath('/srv/bot', { platform: 'linux' })).toBe('/srv/bot/.zhin/gateway.sock');
    expect(isNamedPipe('/srv/bot/.zhin/gateway.sock')).toBe(false);
    const deep = `/srv/${'x'.repeat(120)}`;
    expect(gatewaySocketPath(deep, { platform: 'linux', tmpdir: '/tmp' }))
      .toBe(`/tmp/zhin-gateway-${projectRootHash(deep, 'linux')}.sock`);
  });
});
