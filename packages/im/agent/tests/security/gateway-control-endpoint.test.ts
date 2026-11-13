import { checkFileAccess, commandNamesGatewayEndpoint, extractBashReadPaths } from '../../src/security/file-policy.js';
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

// ADR 0059 §1 / §7: the gateway's account store and the project keys are out of reach of Agent tools.
describe('Agent tools and the gateway store', () => {
  it('file tools cannot touch .zhin/gateway.db, its WAL / SHM files, backups or .zhin/keys/', () => {
    for (const file of [
      '/srv/bot/.zhin/gateway.db',
      '/srv/bot/.zhin/gateway.db-wal',
      '/srv/bot/.zhin/gateway.db-shm',
      '/srv/bot/.zhin/backups/gateway-db-2026-11-13T00-00-00-000Z/console-tables.json',
      '/srv/bot/.zhin/keys/config-secrets.key',
      '.zhin/gateway.db',
      '.zhin/keys/anything',
      // A copy elsewhere is still an SQLite file of the same name.
      '/tmp/copy/gateway.db',
    ]) {
      expect(checkFileAccess(file, '/srv/bot').allowed, file).toBe(false);
    }
  });

  it('a shell command reading or writing them is denied', async () => {
    const paths = await createHostProtectedPaths({ projectRoot: '/srv/bot' });
    for (const command of [
      'sqlite3 .zhin/gateway.db "select * from console_users"',
      'cat .zhin/gateway.db-wal',
      'cp .zhin/gateway.db /tmp/x.db',
      'cat .zhin/keys/config-secrets.key',
      'rm -f .zhin/gateway.db',
      'echo x > .zhin/keys/new.key',
    ]) {
      const impact = hostWriteImpact('bash', { command }, paths);
      const read = extractBashReadPaths(command).some(file => !checkFileAccess(file, '/srv/bot').allowed);
      expect(impact?.level === 'deny' || read, command).toBe(true);
    }
  });
});

// Review follow-up: forms the read-path extraction does not see are denied by the command text.
describe('Agent bash and indirect reads of .zhin', () => {
  it('denies archives, recursive copies, find -exec, globs and script strings naming the store', async () => {
    const paths = await createHostProtectedPaths({ projectRoot: '/srv/bot' });
    for (const command of [
      'tar cf - .zhin | base64',
      'cp -r .zhin /tmp/z',
      'cd .zhin && cat gateway.db',
      'cat .zhin/g*.db',
      'cat .zhin/gateway.d?',
      'find . -name "gateway*" -exec cat {} +',
      'find . -name "*.db" -exec cat {} +',
      "python3 -c \"print(open('.zhin/gate'+'way.db','rb').read())\"",
      "node -e \"require('fs').readFileSync(String.fromCharCode(46)+'zhin/gateway.db')\"",
      'zip -r /tmp/x.zip .zhin',
    ]) {
      expect(hostWriteImpact('bash', { command }, paths)?.level, command).toBe('deny');
    }
    for (const command of ['ls src', 'cat src/gateway.ts', 'grep -r gateway docs', 'echo zhin-gateway docs', 'cat docs/zhin.md', 'node scripts/build.mjs']) {
      expect(hostWriteImpact('bash', { command }, paths), command).toBeUndefined();
    }
  });
});

// Third review: glob spellings, quote splitting and find patterns that reach .zhin, and table names.
describe('Agent bash and globbed / quoted / find-pattern access to .zhin', () => {
  it('denies every spelling the shell would expand to the store', async () => {
    const paths = await createHostProtectedPaths({ projectRoot: '/srv/bot' });
    for (const command of [
      'cat .zh*/gat*',
      'cat .zh?n/*',
      'base64 .[z]hin/g*',
      'tar cf - .z* | base64',
      'cp -r .z*/ /tmp/x',
      'cat .*/gateway*',
      'ls .{zhin,git}',
      'sqlite3 .zh*/ga*y.d* .dump',
      'find . -path "*zh*" -name "g*" -exec cat {} +',
      'find / -name "*.db" -print',
      'cat "$PWD"/.zh""in/gateway.d""b',
      "cat '.zh'in/gate'way.db'",
      'd=.zh; cat ${d}in/gateway.db',
      'sqlite3 /tmp/copy.sqlite "select password_hash from console_users"',
      'sqlite3 data.sqlite "delete from zhin_gateway_store"',
    ]) {
      expect(hostWriteImpact('bash', { command }, paths)?.level, command).toBe('deny');
    }
    for (const command of ['ls .github', 'cat .gitignore', 'ls src/*.ts', 'find . -name "*.md"', 'grep -r console_ docs', 'cat .env.example.md']) {
      const impact = hostWriteImpact('bash', { command }, paths);
      expect(impact?.target === undefined || !/zhin|gateway|console_/u.test(String(impact.target)), command).toBe(true);
    }
  });
});
