import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { LegacyCommandMigrator } from '../src/migrate/index.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true })));
});

describe('legacy Command migration', () => {
  it('extracts static builders and inventories unsafe closures without editing legacy source', async () => {
    const root = await fixture();
    const source = join(root, 'src/legacy.ts');
    const original = await readFile(source, 'utf8');
    const migrator = new LegacyCommandMigrator();
    const plan = await migrator.plan(root);

    expect(migrator.summarize(plan)).toEqual({ automatic: 1, manual: 3, errors: 0 });
    expect(plan.changes).toEqual([expect.objectContaining({
      pattern: 'gh pr <title:text>',
      source,
      target: join(root, 'commands/gh/pr/[title:string].ts'),
    })]);
    expect(plan.diagnostics.map((item) => item.message)).toEqual([
      'Command action captures source bindings: prefix',
      'MessageCommand metadata requires manual migration: permit',
      'MessageCommand matcher options require manual migration',
    ]);
    const generated = plan.changes[0]!.content;
    expect(generated).toContain("import { defineLegacyCommand } from '@zhin.js/next-compat';");
    expect(generated).toContain('description: "create\\npull request"');
    expect(generated).toContain('result.params.title');
    expect(ts.transpileModule(generated, {
      fileName: 'command.ts',
      reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).diagnostics).toEqual([]);

    await migrator.apply(plan);
    await expect(readFile(plan.changes[0]!.target, 'utf8')).resolves.toBe(generated);
    await expect(readFile(source, 'utf8')).resolves.toBe(original);

    const repeated = await migrator.plan(root);
    expect(migrator.summarize(repeated)).toEqual({ automatic: 1, manual: 3, errors: 1 });
    await expect(migrator.apply(repeated)).rejects.toThrow('blocking errors');
  });

  it('rejects colliding command routes before writing any target', async () => {
    const root = await temp();
    await write(join(root, 'src/a.ts'), legacyCommand('status', "() => 'a'"));
    await write(join(root, 'src/b.ts'), legacyCommand('status', "() => 'b'"));
    const migrator = new LegacyCommandMigrator();
    const plan = await migrator.plan(root);

    expect(migrator.summarize(plan)).toEqual({ automatic: 1, manual: 0, errors: 1 });
    await expect(migrator.apply(plan)).rejects.toThrow('blocking errors');
    await expect(readFile(join(root, 'commands/status.ts'), 'utf8')).rejects.toThrow();
  });

  it('rejects forged output paths without touching the referenced file', async () => {
    const root = await temp();
    const protectedFile = join(root, 'protected.ts');
    await writeFile(protectedFile, 'keep');
    const migrator = new LegacyCommandMigrator();
    await expect(migrator.apply({
      root,
      diagnostics: [],
      changes: [{
        source: join(root, 'legacy.ts'),
        target: protectedFile,
        pattern: 'forged',
        content: 'overwrite',
      }],
    })).rejects.toThrow('Invalid migration target');
    await expect(readFile(protectedFile, 'utf8')).resolves.toBe('keep');
  });
});

async function fixture(): Promise<string> {
  const root = await temp();
  await write(join(root, 'src/legacy.ts'), `
import { MessageCommand, usePlugin } from 'zhin.js';
const { addCommand } = usePlugin();

addCommand(
  new MessageCommand('gh pr <title:text>')
    .desc('create', 'pull request')
    .action(async (message, result) => \`${'${message.sender}'}:${'${result.params.title}'}\`),
);

const prefix = 'captured';
addCommand(new MessageCommand('captured').action(() => prefix));
addCommand(new MessageCommand('admin').permit('admin').action(() => 'secret'));
addCommand(new MessageCommand('options', { at: ['id'] }).action(() => 'options'));
`);
  return root;
}

function legacyCommand(pattern: string, action: string): string {
  return `
import { MessageCommand, usePlugin } from 'zhin.js';
const { addCommand } = usePlugin();
addCommand(new MessageCommand('${pattern}').action(${action}));
`;
}

async function temp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-next-migrate-'));
  temporary.push(root);
  return root;
}

async function write(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
}
