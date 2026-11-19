import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const cliPath = path.resolve(__dirname, '../lib/cli.js');

/** Runs the built CLI and reports which of its own modules were loaded (#1250). */
async function runCli(args: readonly string[], env: Record<string, string>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'zhin-cli-instance-child-'));
  try {
    const probe = path.join(dir, 'probe.mjs');
    await writeFile(probe, `
      import { registerHooks } from 'node:module';
      const loaded = [];
      registerHooks({ load(url, context, next) { if (url.includes('/basic/cli/lib/')) loaded.push(url.slice(url.indexOf('/basic/cli/lib/') + 15)); return next(url, context); } });
      process.on('exit', () => process.stderr.write('\\nLOADED ' + JSON.stringify(loaded) + '\\n'));
    `);
    const result = await promisify(execFile)(
      process.execPath,
      ['--import', pathToFileURL(probe).href, cliPath, ...args],
      { cwd: dir, env: { ...process.env, ...env }, timeout: 20_000 },
    ).then((ok) => ({ code: 0, stderr: ok.stderr }), (error: { code: number; stderr: string }) => error);
    const line = result.stderr.split('\n').find((entry) => entry.startsWith('LOADED '));
    return { code: result.code, stderr: result.stderr, loaded: JSON.parse(line?.slice(7) ?? '[]') as string[] };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const built = existsSync(cliPath);

// These tests run the built executable (lib/cli.js): run `pnpm --filter @zhin.js/cli build` first.
describe.skipIf(!built)(
  built
    ? 'supervised instance child entry'
    : 'supervised instance child entry (skipped: basic/cli/lib/cli.js missing, run `pnpm --filter @zhin.js/cli build` first)',
  () => {
  it('starts the instance without loading the CLI command tree', async () => {
    const result = await runCli(['runtime', 'start', '--standalone'], { ZHIN_RUNTIME_CHILD: '1' });
    // No project here: the instance cannot be resolved, reported at the CLI boundary as before.
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^zhin: /mu);
    expect(result.loaded).toContain('commands/runtime-instance.js');
    expect(result.loaded).not.toContain('program.js');
    expect(result.loaded.filter((file) => file.startsWith('commands/') && file !== 'commands/runtime-instance.js')).toEqual([]);
  });

  it('keeps the full command tree for every other invocation', async () => {
    const result = await runCli(['runtime', 'start', '--help'], {});
    expect(result.code).toBe(0);
    expect(result.loaded).toContain('program.js');
    expect(result.loaded).toContain('commands/runtime.js');
  });

  it.each([['--help'], ['-h']])('answers `runtime start %s` from the command tree in the instance child', async (flag) => {
    const result = await runCli(['runtime', 'start', flag], { ZHIN_RUNTIME_CHILD: '1' });
    expect(result.code).toBe(0);
    expect(result.stderr).not.toMatch(/Unknown option/u);
    expect(result.loaded).toContain('program.js');
    expect(result.loaded).toContain('commands/runtime.js');
  });

  it.each([['--verbose'], ['--debug']])('accepts the program-wide %s flag in the instance child', async (flag) => {
    const result = await runCli(['runtime', 'start', '--standalone', flag], { ZHIN_RUNTIME_CHILD: '1' });
    // No project here either: the start fails, but on the missing instance, not on the flag.
    expect(result.code).toBe(1);
    expect(result.stderr).not.toMatch(/Unknown option/u);
    expect(result.loaded).toContain('program.js');
  });
});
