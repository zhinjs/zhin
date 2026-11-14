import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENV_MASK_CHAR } from '@zhin.js/console-protocol';
import {
  maskEnvFileContent,
  readEnvFile,
  readEnvFileView,
  replaceEnvFileContent,
  revealEnvVariable,
  updateEnvVariables,
  writeEnvFile,
} from '../../src/config/environment-files.js';

it('only a missing env file is empty; unreadable existing paths report failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zhin-env-read-'));
  try {
    expect(await readEnvFile(root, '.env')).toBe('');
    await writeEnvFile(root, '.env', 'FAKE_TEST_VALUE=local-only\n');
    expect(await readEnvFile(root, '.env')).toBe('FAKE_TEST_VALUE=local-only\n');
    await mkdir(join(root, '.env.production'));
    await expect(readEnvFile(root, '.env.production')).rejects.toMatchObject({ code: 'EISDIR' });
    await expect(writeEnvFile(root, '.env.production', 'FAKE_TEST_VALUE=changed')).rejects.toMatchObject({ code: 'EISDIR' });
    await expect(readEnvFile(root, '../.env')).rejects.toThrow('Invalid env file');
  } finally { await rm(root, { recursive: true, force: true }); }
});

const FIXTURE = [
  '# Bot credentials',
  'BOT_TOKEN=fake-bot-token-0123456789',
  '',
  'export API_SECRET="fake api secret value"',
  'PORT=8080',
  'SHORT=abcdefgh',
  'EMPTY=',
  'LINKED=${BOT_TOKEN}',
  '# OLD_TOKEN=fake-commented-secret-xyz',
  'not-an-assignment-fake-stray-secret',
  'PRIVATE_KEY="fake-first',
  'fake-second',
  'fake-last"',
  'DUP=fake-first-dup-value',
  'DUP=fake-second-dup-value',
  '',
].join('\n');

const SECRETS = /fake-bot-token|fake api secret|8080|abcdefgh|fake-commented|fake-stray|fake-first|fake-second|fake-last|BOT_TOKEN\}/u;

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-env-mask-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

describe('masked env view (issue #1250)', () => {
  it('never contains a value; keeps comments, blank lines and order', () => {
    const view = maskEnvFileContent('.env', FIXTURE);
    expect(JSON.stringify(view)).not.toMatch(SECRETS);
    expect(view.format).toBe('masked');
    const mask = ENV_MASK_CHAR.repeat(8);
    expect(view.variables).toEqual([
      { key: 'BOT_TOKEN', masked: `fa${mask}89`, length: 25, hasValue: true },
      { key: 'API_SECRET', masked: `fa${mask}ue`, length: 21, hasValue: true },
      // Short and non-secret-looking values are masked the same way, completely.
      { key: 'PORT', masked: mask, length: 4, hasValue: true },
      { key: 'SHORT', masked: mask, length: 8, hasValue: true },
      { key: 'EMPTY', masked: '', length: 0, hasValue: false },
      { key: 'LINKED', masked: `\${${mask}N}`, length: 12, hasValue: true, isReference: true },
      { key: 'PRIVATE_KEY', masked: `fa${mask}st`, length: 32, hasValue: true },
      // A key assigned twice reports the assignment the process reads (the last one).
      { key: 'DUP', masked: `fa${mask}ue`, length: 21, hasValue: true },
    ]);
    expect(view.lines.map(line => line.kind)).toEqual([
      'comment', 'entry', 'blank', 'entry', 'entry', 'entry', 'entry', 'entry', 'comment', 'other', 'entry', 'entry', 'entry',
    ]);
    expect(view.lines[0]).toEqual({ kind: 'comment', text: '# Bot credentials' });
    expect(view.lines[3]).toEqual({ kind: 'entry', key: 'API_SECRET', export: true });
    expect(view.lines[8]).toEqual({ kind: 'comment', key: 'OLD_TOKEN', masked: `fa${mask}yz` });
    expect(view.lines[9]).toEqual({ kind: 'other', length: 35 });
    // `content` (for older Consoles) is masked as well.
    expect(view.content).toContain(`BOT_TOKEN=fa${mask}89`);
    expect(view.content).not.toMatch(SECRETS);
  });

  it('reads a missing file as empty and refuses names outside the env file list', async () => {
    await withRoot(async (root) => {
      expect(await readEnvFileView(root, '.env')).toMatchObject({ variables: [], lines: [], content: '' });
      await expect(readEnvFileView(root, '../.env')).rejects.toThrow('Invalid env file');
      await expect(revealEnvVariable(root, 'zhin.config.yml', 'X')).rejects.toThrow('Invalid env file');
    });
  });

  it('reveals one variable as written (its effective assignment) and nothing else', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, '.env'), FIXTURE);
      expect(await revealEnvVariable(root, '.env', 'API_SECRET')).toEqual({ file: '.env', key: 'API_SECRET', value: '"fake api secret value"' });
      expect(await revealEnvVariable(root, '.env', 'DUP')).toEqual({ file: '.env', key: 'DUP', value: 'fake-second-dup-value' });
      expect((await revealEnvVariable(root, '.env', 'PRIVATE_KEY')).value).toBe('"fake-first\nfake-second\nfake-last"');
      await expect(revealEnvVariable(root, '.env', 'MISSING')).rejects.toThrow('没有变量 MISSING');
      await expect(revealEnvVariable(root, '.env', 'BAD KEY')).rejects.toThrow('变量名无效');
    });
  });

  it('saves only the submitted keys; every other line keeps its bytes', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, '.env'), FIXTURE);
      const result = await updateEnvVariables(root, '.env', [
        { key: 'PORT', value: '9090' },
        { key: 'DUP', value: 'fake-new-dup' },
        { key: 'SHORT', delete: true },
        { key: 'NEW_FLAG', value: '"on and off"' },
      ]);
      expect(result).toEqual({ changed: ['PORT', 'DUP', 'SHORT', 'NEW_FLAG'] });
      const expected = FIXTURE
        .replace('PORT=8080', 'PORT=9090')
        .replace('SHORT=abcdefgh\n', '')
        .replace('DUP=fake-first-dup-value', 'DUP=fake-new-dup')
        .replace('DUP=fake-second-dup-value', 'DUP=fake-new-dup') + 'NEW_FLAG="on and off"\n';
      expect(await readFile(join(root, '.env'), 'utf8')).toBe(expected);
    });
  });

  it('refuses mask placeholders and values that would break the file; nothing is written', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, '.env'), FIXTURE);
      const view = maskEnvFileContent('.env', FIXTURE);
      const bad: unknown[] = [
        [{ key: 'BOT_TOKEN', value: view.variables[0]!.masked }],
        [{ key: 'PORT', value: ENV_MASK_CHAR.repeat(8) }],
        [{ key: 'PORT', value: '●●' }],
        [{ key: 'PORT', value: `"${ENV_MASK_CHAR.repeat(4)}"` }],
        [{ key: 'PORT', value: '1\nINJECTED=1' }],
        [{ key: 'PORT', value: '"1"\nINJECTED=1' }],
        [{ key: 'PORT', value: '"unterminated' }],
        [{ key: 'PORT', value: '1' }, { key: 'PORT', value: '2' }],
        [{ key: 'BAD KEY', value: '1' }],
        [{ key: 'PORT', value: 1 }],
        [{ key: 'PORT', delete: true, value: '1' }],
        [],
        'PORT=1',
      ];
      for (const changes of bad) {
        await expect(updateEnvVariables(root, '.env', changes)).rejects.toMatchObject({ code: 'invalid_env_change' });
      }
      expect(await readFile(join(root, '.env'), 'utf8')).toBe(FIXTURE);
    });
  });

  it('whole-file replace refuses masked content (an older Console saving what it was shown)', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, '.env'), FIXTURE);
      await expect(replaceEnvFileContent(root, '.env', maskEnvFileContent('.env', FIXTURE).content)).rejects.toThrow('打码占位');
      await expect(replaceEnvFileContent(root, '.env', 'PORT=1\nTOKEN=●●●●\n')).rejects.toThrow('TOKEN');
      expect(await readFile(join(root, '.env'), 'utf8')).toBe(FIXTURE);
      await replaceEnvFileContent(root, '.env', 'PORT=1\n');
      expect(await readFile(join(root, '.env'), 'utf8')).toBe('PORT=1\n');
    });
  });
});
