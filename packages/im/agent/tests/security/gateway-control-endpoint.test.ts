import { checkFileAccess, commandNamesGatewayEndpoint } from '../../src/security/file-policy.js';
import { createHostProtectedPaths, hostWriteImpact } from '../../src/security/host-config-paths.js';

// Whoever connects to the management gateway's control endpoint acts as the local owner (ADR 0054 §6).
describe('Agent tools and the gateway control endpoint', () => {
  const fallback = '/tmp/zhin-gateway-0123456789abcdef.sock';

  it('file tools cannot touch the endpoint, including the os.tmpdir() fallback', () => {
    for (const file of ['/srv/bot/.zhin/gateway.sock', fallback, '/var/tmp/ZHIN-GATEWAY-0123456789ABCDEF.sock']) {
      expect(checkFileAccess(file, '/srv/bot').allowed, file).toBe(false);
    }
    expect(checkFileAccess('/srv/bot/src/gateway.ts', '/srv/bot').allowed).toBe(true);
  });

  it('a shell command naming the endpoint is denied, however it connects', async () => {
    const paths = await createHostProtectedPaths({ projectRoot: '/srv/bot' });
    for (const command of [
      `socat - UNIX-CONNECT:${fallback}`,
      `curl --unix-socket ${fallback} http://x/`,
      `curl --unix-socket=${fallback} http://x/`,
      `node -e "require('net').connect('${fallback}')"`,
      'nc -U .zhin/gateway.sock',
      'python3 -c "import socket; s=socket.socket(socket.AF_UNIX); s.connect(\'.zhin/gateway.sock\')"',
      'echo {} > \\\\.\\pipe\\zhin-gateway-0123456789abcdef-a1b2c3',
    ]) {
      expect(hostWriteImpact('bash', { command }, paths)?.level, command).toBe('deny');
    }
    for (const command of ['ls src', 'cat src/gateway.ts', 'echo zhin-gateway docs', 'grep gateway.sock.md README']) {
      expect(hostWriteImpact('bash', { command }, paths), command).toBeUndefined();
    }
  });

  it('denies the actual endpoint the host injected, whatever its name', async () => {
    const endpoint = '/run/custom/control-endpoint';
    const paths = await createHostProtectedPaths({ projectRoot: '/srv/bot', controlEndpoints: [endpoint] });
    expect(paths.denyFiles.has(endpoint)).toBe(true);
    expect(hostWriteImpact('write_file', { file_path: endpoint }, paths)?.level).toBe('deny');
    expect(hostWriteImpact('bash', { command: `nc -U ${endpoint}` }, paths)).toEqual({ level: 'deny', target: endpoint });
    expect(commandNamesGatewayEndpoint('ls /run/custom', [endpoint])).toBeUndefined();
  });
});
