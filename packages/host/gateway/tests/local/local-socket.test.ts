import { spawn } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalGatewayClient, LocalGatewayClientError, LocalGatewayRpcError, probeLocalGateway } from '../../src/local/client.js';
import { LocalControlServer, LocalSocketError, prepareLocalSocketPath } from '../../src/local/local-socket.js';
import { LOCAL_GATEWAY_RPC } from '../../src/local/protocol.js';

const posix = process.platform !== 'win32';
const dirs: string[] = [];
const servers: LocalControlServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(): Promise<{ root: string; path: string }> {
  // Short temp roots keep the socket path inside sun_path.
  const root = await mkdtemp(join(tmpdir(), 'zgw-'));
  dirs.push(root);
  return { root, path: join(root, '.zhin', 'gateway.sock') };
}

async function open(path: string, handler?: Parameters<typeof LocalControlServer.open>[0]['handler']): Promise<LocalControlServer> {
  const server = await LocalControlServer.open({ path, ...(handler ? { handler } : {}) });
  servers.push(server);
  return server;
}

/** A socket whose owner process was SIGKILLed: the file stays, nobody listens. */
async function staleSocket(path: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
  const child = spawn(process.execPath, ['-e', `require('net').createServer().listen(${JSON.stringify(path)}, () => console.log('up'))`], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((resolve) => { child.stdout!.once('data', () => resolve()); });
  child.kill('SIGKILL');
  await new Promise((resolve) => child.once('exit', resolve));
}

describe.runIf(posix)('local control socket', () => {
  it('creates the socket with mode 0600 and answers JSON-lines requests with streamed events', async () => {
    const { root, path } = await project();
    await open(path, async (request, emit) => {
      if (request.type === 'echo') {
        emit({ type: 'phase', id: 't1', phase: 'snapshot' });
        return { ok: true, data: request.data };
      }
      return { ok: false, error: { code: 'forbidden', message: 'no', status: 403 } };
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await lstat(path)).isSocket()).toBe(true);
    const client = await LocalGatewayClient.connect({ root, path });
    const events: unknown[] = [];
    await expect(client.request('echo', { a: 1 }, { onEvent: (event) => events.push(event) })).resolves.toEqual({ a: 1 });
    expect(events).toEqual([{ type: 'phase', id: 't1', phase: 'snapshot' }]);
    await expect(client.request('other')).rejects.toMatchObject({ name: 'LocalGatewayRpcError', code: 'forbidden' });
    client.close();
  });

  it('answers unavailable until the handler is installed', async () => {
    const { root, path } = await project();
    const server = await open(path);
    const client = await LocalGatewayClient.connect({ root, path });
    await expect(client.request(LOCAL_GATEWAY_RPC.INFO)).rejects.toBeInstanceOf(LocalGatewayRpcError);
    server.setHandler(async () => ({ ok: true, data: 'ready' }));
    await expect(client.request(LOCAL_GATEWAY_RPC.INFO)).resolves.toBe('ready');
    client.close();
  });

  it('refuses a second gateway while the first one answers', async () => {
    const { path } = await project();
    await open(path);
    await expect(LocalControlServer.open({ path })).rejects.toMatchObject({ name: 'LocalSocketError', code: 'in_use' });
  });

  it('removes a stale socket left by a dead gateway', async () => {
    const { root, path } = await project();
    await staleSocket(path);
    expect((await lstat(path)).isSocket()).toBe(true);
    // Clients see "not running", not an error.
    await expect(probeLocalGateway({ root, path })).resolves.toBeUndefined();
    await expect(prepareLocalSocketPath(path)).resolves.toEqual({ removedStale: true });
    await staleSocket(path);
    await open(path, async () => ({ ok: true, data: 1 }));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('refuses paths owned by another user and insecure directories', async () => {
    const { root, path } = await project();
    const other = () => (process.getuid?.() ?? 0) + 1;
    await expect(LocalControlServer.open({ path, uid: other })).rejects.toMatchObject({ code: 'insecure_dir' });
    await open(path);
    // The client refuses a socket that does not belong to the current user.
    await expect(LocalGatewayClient.connect({ root, path, uid: other })).rejects.toMatchObject({ name: 'LocalGatewayClientError', code: 'not_owner' });
    await expect(probeLocalGateway({ root, path, uid: other })).rejects.toBeInstanceOf(LocalGatewayClientError);

    const loose = join(root, 'loose');
    await mkdir(loose);
    await chmod(loose, 0o777);
    await expect(prepareLocalSocketPath(join(loose, 'gateway.sock'))).rejects.toMatchObject({ code: 'insecure_dir' });
    const notSocket = join(root, '.zhin', 'plain.sock');
    await writeFile(notSocket, 'x');
    await expect(prepareLocalSocketPath(notSocket)).rejects.toBeInstanceOf(LocalSocketError);
  });

  it('reports not_running when there is no socket', async () => {
    const { root, path } = await project();
    await expect(LocalGatewayClient.connect({ root, path })).rejects.toMatchObject({ code: 'not_running' });
    await expect(probeLocalGateway({ root, path })).resolves.toBeUndefined();
  });

  it('removes its socket file on close', async () => {
    const { path } = await project();
    const server = await open(path);
    await server.close();
    await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
