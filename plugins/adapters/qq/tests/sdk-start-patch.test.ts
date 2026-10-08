import { mkdtemp, cp, symlink, rm, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

it('published SDK patch owns auth/receiver rejection, synchronous ready and startup listener cleanup', async () => {
  const require = createRequire(import.meta.url);
  const sdkRoot = dirname(require.resolve('qq-official-bot/package.json'));
  const temp = await mkdtemp(join(tmpdir(), 'qq-sdk-patch-'));
  try {
    await cp(join(sdkRoot, 'lib'), join(temp, 'lib'), { recursive: true });
    await symlink(resolve(sdkRoot, '..'), join(temp, 'node_modules'), 'dir');
    const source = await readFile(join(temp, 'lib/core/session.js'), 'utf8');
    if (!source.includes('Never use an async Promise executor')) execFileSync('patch', ['-p1', '-i', resolve(import.meta.dirname, '../../../../patches/qq-official-bot@1.3.0.patch')], { cwd: temp });
    const { Session } = require(join(temp, 'lib/core/session.js'));
    const receiver = Object.assign(new EventEmitter(), { start: vi.fn(async () => { receiver.emit('ready'); }) });
    // Exercise actual patched published method without constructing external network clients.
    const session = Object.assign(Object.create(Session.prototype), { receiver, userClose: false, getAccessToken: vi.fn(async () => ({})) });
    const existingError = vi.fn(); receiver.on('error', existingError);
    const assertClean = () => { expect(receiver.listenerCount('ready')).toBe(0); expect(receiver.listenerCount('stop')).toBe(0); expect(receiver.listenerCount('error')).toBe(1); };
    const authError = new Error('auth refused'); session.getAccessToken.mockRejectedValueOnce(authError);
    await expect(session.start()).rejects.toBe(authError); expect(receiver.start).not.toHaveBeenCalled(); assertClean();
    await expect(session.start()).resolves.toBeUndefined(); assertClean();
    const gatewayError = new Error('gateway refused'); receiver.start.mockRejectedValueOnce(gatewayError);
    await expect(session.start()).rejects.toBe(gatewayError); assertClean();
    receiver.start.mockImplementationOnce(async () => { receiver.emit('error', gatewayError); throw gatewayError; });
    await expect(session.start()).rejects.toBe(gatewayError); assertClean(); expect(existingError).toHaveBeenCalledWith(gatewayError);
    receiver.start.mockImplementationOnce(() => new Promise<void>(() => {}));
    const starting = session.start(); const stopped = expect(starting).rejects.toThrow('startup stopped');
    await Promise.resolve(); await Promise.resolve(); receiver.emit('stop'); await stopped; assertClean();
    let authReady!: () => void;
    session.getAccessToken.mockImplementationOnce(() => new Promise<void>(done => { authReady = done; }));
    const authenticating = session.start(); const cancelled = expect(authenticating).rejects.toThrow('startup stopped');
    session.userClose = true; authReady(); await cancelled; assertClean();
    await new Promise(done => setImmediate(done));
  } finally { await rm(temp, { recursive: true, force: true }); }
});
