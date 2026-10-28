import { describe, expect, it } from 'vitest';
import { hostConfigWriteTarget, isHostConfigPath } from '../../src/security/host-config-paths.js';

describe('isHostConfigPath', () => {
  it.each([
    '/ws/zhin.config.yml', '/ws/zhin.config.yaml', '/ws/zhin.config.json', '/ws/zhin.config.ts', '/ws/.zhin.config',
    '/ws/.env', '/ws/.env.production', '/ws/package.json', '/ws/plugins/x/package.json', '/ws/pnpm-lock.yaml',
    '/ws/pnpm-workspace.yaml', '/ws/.npmrc', '/ws/.pnpmfile.cjs', '/ws/assistant.profile.yml',
    '/ws/node_modules/zhin.js/lib/index.js', '/ws/.git/hooks/post-checkout', 'zhin.config.yml', 'C:\\ws\\.env',
  ])('protects %s', path => {
    expect(isHostConfigPath(path)).toBe(true);
  });

  it.each(['/ws/notes.md', '/ws/data/memory/today.md', '/ws/my-zhin.config.yml.bak.txt', '/ws/src/package.json.ts', '/ws/.gitignore', '', '  '])(
    'leaves %j alone', path => {
      expect(isHostConfigPath(path)).toBe(false);
    },
  );
});

describe('hostConfigWriteTarget', () => {
  it('judges file tools by their target path', () => {
    expect(hostConfigWriteTarget('write_file', { file_path: '/ws/zhin.config.yml' })).toBe('/ws/zhin.config.yml');
    expect(hostConfigWriteTarget('edit_file', { file_path: '/ws/.env' })).toBe('/ws/.env');
    expect(hostConfigWriteTarget('write_file', { file_path: '/ws/notes.md' })).toBeUndefined();
    // Reading config is not a self-change.
    expect(hostConfigWriteTarget('read_file', { file_path: '/ws/zhin.config.yml' })).toBeUndefined();
  });

  it.each([
    ['echo "a: 1" >> zhin.config.yml', 'zhin.config.yml'],
    ['echo x >zhin.config.yml', 'zhin.config.yml'],
    ['cat patch | tee -a .env', '.env'],
    ["sed -i 's/ask/bypass/' zhin.config.yml", 'zhin.config.yml'],
    ['cp evil.json package.json', 'package.json'],
    ['pnpm add left-pad', 'package.json'],
    ['cd plugins && npm install', 'package.json'],
    ['git config core.hooksPath x && cp hook .git/hooks/pre-commit', '.git/hooks/pre-commit'],
  ])('flags the shell command %j', (command, target) => {
    expect(hostConfigWriteTarget('bash', { command })).toBe(target);
  });

  it.each(['cat zhin.config.yml', 'grep apiKey .env', 'ls node_modules', 'pnpm test', 'git status', 'echo hello > notes.md'])(
    'lets the shell command %j through', command => {
      expect(hostConfigWriteTarget('bash', { command })).toBeUndefined();
    },
  );
});
