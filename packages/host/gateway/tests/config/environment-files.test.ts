import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENV_MASK_CHAR, maskConsoleEnvValue } from '@zhin.js/console-protocol';
import { parse } from 'dotenv';
import {
  applyEnvChanges,
  maskEnvFileContent,
  readEnvFile,
  readEnvFileView,
  replaceEnvFileContent,
  revealEnvVariable,
  EnvChangeError,
  updateEnvVariables,
  validateEnvChanges,
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
      { key: 'BOT_TOKEN', masked: `fa${mask}89`, hasValue: true },
      { key: 'API_SECRET', masked: `fa${mask}ue`, hasValue: true },
      // Short (under 16 characters) and non-secret-looking values are masked the same way, completely.
      { key: 'PORT', masked: mask, hasValue: true },
      { key: 'SHORT', masked: mask, hasValue: true },
      { key: 'EMPTY', masked: '', hasValue: false },
      { key: 'LINKED', masked: mask, hasValue: true, isReference: true },
      { key: 'PRIVATE_KEY', masked: `fa${mask}st`, hasValue: true },
      // A key assigned twice reports the assignment the process reads (the last one).
      { key: 'DUP', masked: `fa${mask}ue`, hasValue: true },
    ]);
    expect(view.lines.map(line => line.kind)).toEqual([
      'comment', 'entry', 'blank', 'entry', 'entry', 'entry', 'entry', 'entry', 'comment', 'other', 'entry', 'entry', 'entry',
    ]);
    expect(view.lines[0]).toEqual({ kind: 'comment', text: '# Bot credentials' });
    expect(view.lines[3]).toEqual({ kind: 'entry', key: 'API_SECRET', export: true });
    expect(view.lines[8]).toEqual({ kind: 'comment', key: 'OLD_TOKEN', masked: `fa${mask}yz` });
    // Neither a value's length nor a stray line's length is told.
    expect(view.lines[9]).toEqual({ kind: 'other' });
    expect(JSON.stringify(view)).not.toMatch(/"length"/u);
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

  it('refuses a value whose closing quote is followed by text (dotenv would read the next line as a new variable)', async () => {
    await withRoot(async (root) => {
      await writeFile(join(root, '.env'), 'A=1\n');
      for (const value of [
        '"x\nNODE_OPTIONS=--require=/tmp/evil.js"zz',
        "'x\nNODE_OPTIONS=--require=/tmp/evil.js'zz",
        '`x\nNODE_OPTIONS=--require=/tmp/evil.js`zz',
        '"x"zz',
        '"x" zz',
        '"x\nNODE_OPTIONS=1" "',
        ' \n"x"',
      ]) {
        await expect(updateEnvVariables(root, '.env', [{ key: 'KEY', value }]), JSON.stringify(value)).rejects.toMatchObject({ code: 'invalid_env_change' });
      }
      expect(await readFile(join(root, '.env'), 'utf8')).toBe('A=1\n');
      // Inline comments after the closing quote are still fine.
      await updateEnvVariables(root, '.env', [{ key: 'KEY', value: '"a\nb" # note' }]);
      expect(parse(await readFile(join(root, '.env'), 'utf8'))).toEqual({ A: '1', KEY: 'a\nb' });
    });
  });

  it('an unterminated quote does not swallow the following lines (view, reveal and save follow dotenv)', async () => {
    await withRoot(async (root) => {
      const file = 'A="unterminated\nB="secretB"\nC=plainC\n';
      await writeFile(join(root, '.env'), file);
      expect(parse(file)).toEqual({ A: '"unterminated', B: 'secretB', C: 'plainC' });
      const view = await readEnvFileView(root, '.env');
      expect(view.variables.map(variable => variable.key)).toEqual(['A', 'B', 'C']);
      expect(view.lines).toEqual([{ kind: 'entry', key: 'A' }, { kind: 'entry', key: 'B' }, { kind: 'entry', key: 'C' }]);
      expect(await revealEnvVariable(root, '.env', 'A')).toEqual({ file: '.env', key: 'A', value: '"unterminated' });
      expect((await revealEnvVariable(root, '.env', 'B')).value).toBe('"secretB"');
      await updateEnvVariables(root, '.env', [{ key: 'A', value: 'x' }]);
      expect(await readFile(join(root, '.env'), 'utf8')).toBe('A=x\nB="secretB"\nC=plainC\n');
    });
  });

  it('a save after which dotenv would read an unsubmitted key differently is refused (invariant)', () => {
    // applyEnvChanges itself does not validate values: the dotenv read-back check is the last guard.
    expect(() => applyEnvChanges('A=1\n', [{ key: 'KEY', value: '"x\nNODE_OPTIONS=--require=/tmp/evil.js"zz' }]))
      .toThrow(/NODE_OPTIONS/u);
    expect(() => applyEnvChanges('B=2\nA=1\n', [{ key: 'A', value: '"x\nB=3"zz' }])).toThrow(/B/u);
    expect(() => applyEnvChanges('A=1\n', [{ key: 'A', value: '"open' + '\nC=1' }])).toThrow(EnvChangeError);
    // `KEY:` followed by a line: dotenv reads that line as KEY's value, and so does the view.
    const file = 'NOTE:\nHIDDEN=1\nA=1\n';
    expect(parse(file)).toEqual({ NOTE: 'HIDDEN=1', A: '1' });
    expect(maskEnvFileContent('.env', file).variables.map(variable => variable.key)).toEqual(['NOTE', 'A']);
    expect(applyEnvChanges(file, [{ key: 'NOTE', delete: true }])).toBe('A=1\n');
    expect(parse(applyEnvChanges(file, [{ key: 'NOTE', value: 'v' }]))).toEqual({ NOTE: 'v', A: '1' });
  });

  it('masks every comment that carries a value, in lines and content', () => {
    const file = [
      '## OLD_TOKEN=sk-fake-commented-aaaa',
      '# token: sk-fake-colon-bbbbbbbb',
      '#- KEY=fake-dash-cccccccc',
      '# the old one was = fake-free-dddddddd',
      '# see: fake-url-eeeeeeee',
      '# plain words only',
      '# EMPTY=',
      '',
    ].join('\n');
    const view = maskEnvFileContent('.env', file);
    expect(JSON.stringify(view)).not.toMatch(/fake-/u);
    const mask = ENV_MASK_CHAR.repeat(8);
    expect(view.lines).toEqual([
      { kind: 'comment', key: 'OLD_TOKEN', masked: `sk${mask}aa` },
      { kind: 'comment', key: 'token', masked: `sk${mask}bb` },
      { kind: 'comment', key: 'KEY', masked: `fa${mask}cc` },
      { kind: 'comment', text: `# the old one was = fa${mask}dd` },
      { kind: 'comment', key: 'see', masked: `fa${mask}ee` },
      { kind: 'comment', text: '# plain words only' },
      { kind: 'comment', text: '# EMPTY=' },
    ]);
  });
});

/** A small deterministic PRNG, so a failure names a reproducible case. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYS = ['A', 'B', 'C', 'D_1', 'e.f', 'NODE_OPTIONS'];
const LINE_SHAPES: ((key: string, other: string) => string)[] = [
  key => `${key}=plain-value-0123456789`,
  key => `${key}="double quoted"`,
  key => `${key}='single quoted'`,
  key => `${key}=\`back quoted\``,
  key => `${key}="multi\nline\nvalue"`,
  key => `${key}='multi\nline'`,
  (key, other) => `${key}="unterminated\n${other}="secret-${other}"`,
  (key, other) => `${key}='unterminated\n${other}=x'`,
  (key, other) => `${key}="x"zz\n${other}=y"`,
  key => `export ${key}=exported`,
  key => `  ${key} = spaced  `,
  key => `${key}: colon value`,
  (key, other) => `${key}:\n${other}=swallowed`,
  key => `${key}=`,
  key => `${key}=value # inline comment`,
  key => `${key}="a\\"b"`,
  key => `${key}="ends with backslash\\"`,
  key => `${key}=it's`,
  (key, other) => `${key}=\n"${other}-next-line"`,
  (key, other) => `# ${key}=commented-${other}`,
  () => '# just a comment',
  () => '',
  () => 'stray text without assignment',
  (key, other) => `${key}="x\n# ${other}=inside"`,
];
const VALUES = [
  'new-plain', '"new quoted"', "'new single'", '"new\nmulti"', '', 'with space', '"x"zz', '"x\nNODE_OPTIONS=1"zz',
  '"unterminated', 'x\nY=1', '"ok" # c', 'p#ss', '`bt`', '"a\\"', "'it''s'", '${A}',
];

function generated(next: () => number): { content: string; changes: unknown[] } {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const lines = Array.from({ length: 1 + Math.floor(next() * 7) }, () => pick(LINE_SHAPES)(pick(KEYS), pick(KEYS)));
  const eol = next() < 0.2 ? '\r\n' : '\n';
  const content = lines.join('\n').replace(/\n/gu, eol) + (next() < 0.8 ? eol : '');
  const keys = [...new Set(Array.from({ length: 1 + Math.floor(next() * 3) }, () => pick(KEYS)))];
  const changes = keys.map(key => next() < 0.25 ? { key, delete: true } : { key, value: pick(VALUES) });
  return { content, changes };
}

describe('env view, reveal and save follow dotenv (property, issue #1250 review)', () => {
  it('for generated files and changes: same keys, same values, untouched keys unchanged', async () => {
    await withRoot(async (root) => {
      const next = random(1250);
      let saved = 0;
      for (let round = 0; round < 400; round += 1) {
        const { content, changes } = generated(next);
        const label = JSON.stringify({ round, content, changes });
        const expected = parse(content);
        const view = maskEnvFileContent('.env', content);
        expect(view.variables.map(variable => variable.key).sort(), label).toEqual(Object.keys(expected).sort());
        for (const variable of view.variables) expect(variable.masked, label).toBe(maskConsoleEnvValue(expected[variable.key]!));
        await writeFile(join(root, '.env'), content);
        for (const key of Object.keys(expected)) {
          const { value } = await revealEnvVariable(root, '.env', key);
          // The text revealed is the variable's own value as written: dotenv reads it as that value.
          expect(parse(`${key}=${value}`)[key], `${label} reveal ${key}`).toBe(expected[key]);
          for (const other of Object.keys(expected)) {
            if (other !== key && expected[other]!.length > 3 && !expected[key]!.includes(expected[other]!)) {
              expect(value, `${label} reveal ${key} leaks ${other}`).not.toContain(expected[other]);
            }
          }
        }
        let valid: ReturnType<typeof validateEnvChanges>;
        try { valid = validateEnvChanges(changes); } catch { continue; }
        try {
          await updateEnvVariables(root, '.env', valid);
        } catch (error) {
          expect((error as { code?: string }).code, label).toBe('invalid_env_change');
          expect(await readFile(join(root, '.env'), 'utf8'), label).toBe(content);
          continue;
        }
        saved += 1;
        const after = parse(await readFile(join(root, '.env'), 'utf8'));
        const submitted = new Set(valid.map(change => change.key));
        for (const key of new Set([...Object.keys(expected), ...Object.keys(after)])) {
          if (!submitted.has(key)) expect(after[key], `${label} kept ${key}`).toBe(expected[key]);
        }
        for (const change of valid) {
          if ('delete' in change) expect(after, label).not.toHaveProperty(change.key);
          else expect(after[change.key], label).toBe(parse(`${change.key}=${change.value}`)[change.key]);
        }
      }
      // The generator must exercise saves, not only refusals.
      expect(saved).toBeGreaterThan(100);
    });
  }, 60_000);
});
