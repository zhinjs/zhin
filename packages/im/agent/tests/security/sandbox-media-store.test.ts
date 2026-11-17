import { checkFileAccess, commandNamesProtectedStore, extractBashReadPaths } from '../../src/security/file-policy.js';
import { createHostProtectedPaths, hostWriteImpact } from '../../src/security/host-config-paths.js';

// ADR 0064 D12 (revised 2026-11-17): the Sandbox's hosted uploads and the key that signs their
// links live in `.zhin/sandbox/`; Agent file tools and shell commands must not reach either.
describe('Agent tools and the Sandbox media store', () => {
  const files = [
    '/srv/bot/.zhin/sandbox/media/secret',
    '/srv/bot/.zhin/sandbox/media/0123456789abcdef/AAAAAAAAAAAAAAAAAAAAAA',
    '/srv/bot/.zhin/sandbox/media/0123456789abcdef/AAAAAAAAAAAAAAAAAAAAAA.json',
    '/srv/bot/.zhin/sandbox',
    '.zhin/sandbox/media/secret',
    './.zhin/sandbox/media',
    'sub/../.zhin/sandbox/media/secret',
  ];

  it('file tools (read_file / write_file / edit_file) cannot touch it', () => {
    for (const file of files) expect(checkFileAccess(file, '/srv/bot').allowed, file).toBe(false);
    const reason = checkFileAccess('/srv/bot/.zhin/sandbox/media/secret', '/srv/bot').reason ?? '';
    expect(reason).toMatch(/\.zhin/u);
    // Case-insensitive file systems (macOS, Windows) and Windows' trailing-dot stripping open the
    // same directory under another spelling.
    for (const file of ['/srv/bot/.ZHIN/sandbox/media/secret', '/srv/bot/.Zhin/Sandbox/media/secret', '/srv/bot/.zhin./sandbox/media/secret', '/srv/bot/.SSH/id_x']) {
      expect(checkFileAccess(file, '/srv/bot').allowed, file).toBe(false);
    }
    // Ordinary sources named sandbox stay readable.
    expect(checkFileAccess('/srv/bot/plugins/adapters/sandbox/src/media-store.ts', '/srv/bot').allowed).toBe(true);
  });

  it('shell commands naming it are denied, read or write, direct or indirect', async () => {
    const paths = await createHostProtectedPaths({ projectRoot: '/srv/bot' });
    for (const command of [
      'cat .zhin/sandbox/media/secret',
      'cp -r .zhin/sandbox /tmp/x',
      'tar cf - .zhin/sandbox',
      'find .zhin/sandbox -type f -exec cat {} +',
      'rm -rf .zhin/sandbox/media',
      'echo x > .zhin/sandbox/media/secret',
      'node -e "require(\'fs\').readFileSync(\'.zhin/sandbox/media/secret\')"',
      'cd .zhin && cat sandbox/media/secret',
      'cat /srv/bot/.zhin/sandbox/media/secret',
    ]) {
      const impact = hostWriteImpact('bash', { command }, paths);
      const read = extractBashReadPaths(command).some(file => !checkFileAccess(file, '/srv/bot').allowed);
      expect(impact?.level === 'deny' || read, command).toBe(true);
      expect(commandNamesProtectedStore(command), command).toBeDefined();
    }
    for (const command of ['ls plugins/adapters/sandbox', 'cat plugins/adapters/sandbox/README.md', 'pnpm --filter @zhin.js/adapter-sandbox build']) {
      expect(commandNamesProtectedStore(command), command).toBeUndefined();
    }
  });
});
