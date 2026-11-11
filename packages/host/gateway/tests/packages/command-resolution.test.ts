import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  createStreamingPackageManager,
  quoteWindowsCmdArgument,
  resolveCommand,
  translatePackageManagerArgs,
} from '../../src/onboarding/package-manager.js';

const windowsEnv = { Path: 'C:\\Windows\\System32;"C:\\Program Files\\nodejs";C:\\Users\\me\\AppData\\Roaming\\npm', PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe' };

describe('package-manager command resolution', () => {
  it('keeps POSIX commands unchanged', () => {
    expect(resolveCommand('pnpm', ['add', 'pg@^8'], { platform: 'linux' })).toEqual({ command: 'pnpm', args: ['add', 'pg@^8'] });
    expect(resolveCommand('npm', ['ci'], { platform: 'darwin' })).toEqual({ command: 'npm', args: ['ci'] });
  });

  it('runs a Windows .cmd shim through cmd.exe with quoted, escaped arguments', () => {
    const files = new Set(['C:\\Users\\me\\AppData\\Roaming\\npm\\pnpm.cmd']);
    const resolved = resolveCommand('pnpm', ['add', '-w', 'pg@^8.0.0'], { platform: 'win32', env: windowsEnv, isFile: path => files.has(path) });
    expect(resolved.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(resolved.windowsVerbatimArguments).toBe(true);
    expect(resolved.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    // Metacharacters are escaped twice because the shim re-expands %*.
    expect(resolved.args[3]).toBe('"C:\\Users\\me\\AppData\\Roaming\\npm\\pnpm.cmd ^^^"add^^^" ^^^"-w^^^" ^^^"pg@^^^^8.0.0^^^""');
  });

  it('prefers PATH order and PATHEXT order, and escapes spaces in the shim path', () => {
    const files = new Set(['C:\\Program Files\\nodejs\\npm.cmd', 'C:\\Users\\me\\AppData\\Roaming\\npm\\npm.cmd']);
    const resolved = resolveCommand('npm', ['ci'], { platform: 'win32', env: windowsEnv, isFile: path => files.has(path) });
    expect(resolved.args[3]).toBe('"C:\\Program^ Files\\nodejs\\npm.cmd ^^^"ci^^^""');
  });

  it('spawns a Windows executable directly', () => {
    const files = new Set(['C:\\Program Files\\nodejs\\bun.exe', 'C:\\Program Files\\nodejs\\bun.cmd']);
    expect(resolveCommand('bun', ['install', '--frozen-lockfile'], { platform: 'win32', env: windowsEnv, isFile: path => files.has(path) }))
      .toEqual({ command: 'C:\\Program Files\\nodejs\\bun.exe', args: ['install', '--frozen-lockfile'] });
  });

  it('falls back to <name>.cmd through cmd.exe when PATH has no match', () => {
    const resolved = resolveCommand('yarn', ['add', 'pg'], { platform: 'win32', env: { PATH: '' }, isFile: () => false });
    expect(resolved).toEqual({ command: 'cmd.exe', args: ['/d', '/s', '/c', '"yarn.cmd ^^^"add^^^" ^^^"pg^^^""'], windowsVerbatimArguments: true });
  });

  it('quotes arguments by the CommandLineToArgvW rules', () => {
    expect(quoteWindowsCmdArgument('a b', false)).toBe('^"a^ b^"');
    expect(quoteWindowsCmdArgument('say "hi"', false)).toBe('^"say^ \\^"hi\\^"^"');
    expect(quoteWindowsCmdArgument('dir\\', false)).toBe('^"dir\\\\^"');
    expect(quoteWindowsCmdArgument('>=1.0.0', false)).toBe('^"^>=1.0.0^"');
    expect(quoteWindowsCmdArgument('a&b|c', true)).toBe('^^^"a^^^&b^^^|c^^^"');
  });

  it('streams through the resolved Windows command without a shell', async () => {
    const invocations: { command: string; args: string[]; options: Record<string, unknown> }[] = [];
    const fakeSpawn = ((command: string, args: string[], options: Record<string, unknown>) => {
      invocations.push({ command, args, options });
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
      setImmediate(() => child.emit('close', 0, null));
      return child;
    }) as unknown as typeof import('node:child_process').spawn;
    const run = createStreamingPackageManager(() => undefined, { manager: 'pnpm', spawn: fakeSpawn, platform: 'win32', env: { PATH: '', ComSpec: 'cmd.exe' } });
    await run(['install', '--frozen-lockfile'], process.cwd());
    expect(invocations[0]).toMatchObject({ command: 'cmd.exe', args: ['/d', '/s', '/c', '"pnpm.cmd ^^^"install^^^" ^^^"--frozen-lockfile^^^""'], options: { shell: false, windowsVerbatimArguments: true } });
  });

  it('translates the gateway update / install commands per manager', () => {
    expect(translatePackageManagerArgs('pnpm', ['install', '--frozen-lockfile'])).toEqual(['install', '--frozen-lockfile']);
    expect(translatePackageManagerArgs('npm', ['install', '--frozen-lockfile'])).toEqual(['ci']);
    expect(translatePackageManagerArgs('yarn', ['install'])).toEqual(['install']);
    expect(translatePackageManagerArgs('pnpm', ['update', 'pg'])).toEqual(['update', 'pg']);
    expect(translatePackageManagerArgs('yarn', ['update', 'pg'])).toEqual(['upgrade', 'pg']);
    expect(translatePackageManagerArgs('npm', ['update'])).toEqual(['update']);
    expect(() => translatePackageManagerArgs('pnpm', ['install', '--ignore-scripts=false'])).toThrow();
    expect(() => translatePackageManagerArgs('pnpm', ['update', '--latest'])).toThrow();
    expect(() => translatePackageManagerArgs('pnpm', ['update', '-D', 'pg'])).toThrow();
  });
});
