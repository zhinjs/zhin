import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { installProcessRejectionHandler } from '../../src/plugin-runtime/process-rejections.js';

describe('Process Host rejection reporting', () => {
  it('reports without stopping and removes only its own listener', async () => {
    const source = new EventEmitter();
    const report = vi.fn();
    const external = vi.fn();
    source.on('unhandledRejection', external);
    const dispose = installProcessRejectionHandler(source, report);
    const failure = new Error('packet timeout');
    source.emit('unhandledRejection', failure);
    expect(report).toHaveBeenCalledWith(failure);
    dispose();
    dispose();
    source.emit('unhandledRejection', new Error('after disposal'));
    expect(report).toHaveBeenCalledTimes(1);
    expect(external).toHaveBeenCalledTimes(2);
    expect(source.listenerCount('unhandledRejection')).toBe(1);
  });

  it.each(['sync', 'async'] as const)('contains a failing %s reporter', async (kind) => {
    const source = new EventEmitter();
    const failure = new Error('report failed');
    const dispose = installProcessRejectionHandler(source, () => {
      if (kind === 'sync') throw failure;
      return Promise.reject(failure);
    });
    expect(() => source.emit('unhandledRejection', new Error('original'))).not.toThrow();
    await new Promise<void>(done => setImmediate(done));
    dispose();
  });

  it('keeps a real Node process running after an unobserved timer promise and still exits on caught startup failure', async () => {
    const entry = pathToFileURL(resolve('basic/cli/src/plugin-runtime/process-rejections.ts')).href;
    const run = (script: string) => new Promise<{ code: number | null; output: string }>((done, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', '--unhandled-rejections=throw', '--input-type=module', '-e', script], {
        cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', chunk => { output += String(chunk); });
      child.stderr.on('data', chunk => { output += String(chunk); });
      child.once('error', reject);
      child.once('close', code => done({ code, output }));
    });
    const baseline = await run(`
      setTimeout(() => { void Promise.reject(new Error('sso timeout')); }, 0);
      setTimeout(() => console.log('alive'), 30);
    `);
    expect(baseline.code).not.toBe(0);
    expect(baseline.output).toContain('sso timeout');
    expect(baseline.output).not.toContain('alive');
    const script = `
      import { installProcessRejectionHandler } from ${JSON.stringify(entry)};
      const dispose = installProcessRejectionHandler(process, reason => console.error('reported:' + reason.message));
      setTimeout(() => { void Promise.reject(new Error('sso timeout')); }, 0);
      setTimeout(async () => {
        console.log('alive');
        try { await Promise.reject(new Error('startup failed')); }
        catch (error) { console.error(error.message); process.exitCode = 1; }
        dispose();
        console.log('listeners:' + process.listenerCount('unhandledRejection'));
      }, 30);
    `;
    const result = await run(script);
    expect(result.output).toContain('reported:sso timeout');
    expect(result.output).toContain('alive');
    expect(result.output).toContain('startup failed');
    expect(result.output).toContain('listeners:0');
    expect(result.code).toBe(1);
  });
});
