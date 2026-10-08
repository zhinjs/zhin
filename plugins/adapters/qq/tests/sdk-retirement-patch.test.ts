import { mkdtemp, cp, symlink, rm, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

async function sdkFixture() {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve('qq-official-bot/package.json'));
  const directory = await mkdtemp(join(tmpdir(), 'qq-retirement-'));
  await cp(join(root, 'lib'), join(directory, 'lib'), { recursive: true });
  await symlink(resolve(root, '..'), join(directory, 'node_modules'), 'dir');
  const patch = await readFile(resolve(import.meta.dirname, '../../../../patches/qq-official-bot@1.3.0.patch'), 'utf8');
  const markers: Record<string, string> = { 'lib/bot.js': 'Composition roots own process errors', 'lib/core/session.js': 'Never use an async Promise executor', 'lib/core/auth.js': 'this.destroyed = false', 'lib/receivers/websocket.js': 'A late gateway lookup', 'lib/events/notice.js': 'payload.data.resolved?.user_id', 'lib/message/file-processor.js': 'Infer only a complete contiguous set' };
  for (const section of patch.split(/(?=^--- a\/)/m).filter(Boolean)) {
    const file = section.match(/^--- a\/(.+)/)?.[1];
    if (file && !(await readFile(join(directory, file), 'utf8')).includes(section.includes('Optional instance-scoped transport extension') ? 'Optional instance-scoped transport extension' : markers[file])) execFileSync('patch', ['-p1'], { cwd: directory, input: section });
  }
  return { require, directory, Bot: require(join(directory, 'lib/bot.js')).Bot, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
it('real published SDK never opens a late gateway socket after startup was stopped', async () => {
  const fixture = await sdkFixture();
  const { WebSocketServer } = fixture.require('ws');
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(done => server.once('listening', done));
  let connections = 0; server.on('connection', () => connections++);
  const bot = new fixture.Bot({ appid: 'fixture', secret: 'fixture', mode: 'websocket', logLevel: 'off' });
  let release!: (value: string) => void;
  let reached!: () => void; const fetching = new Promise<void>(done => { reached = done; });
  bot.sessionManager.getAccessToken = async () => 'fixture';
  bot.sessionManager.getWsUrl = () => { reached(); return new Promise<string>(done => { release = done; }); };
  try {
    const starting = bot.start(); const cancelled = expect(starting).rejects.toThrow('startup stopped');
    await fetching; await bot.stop(); bot.sessionManager.authManager.destroy(); await cancelled;
    release(`ws://127.0.0.1:${server.address().port}`);
    await new Promise(done => setTimeout(done, 30));
    expect(connections).toBe(0); expect(bot.receiver.handler.ws).toBeUndefined();
  } finally {
    await bot.stop(); bot.sessionManager.authManager.destroy();
    for (const socket of server.clients) socket.terminate(); await new Promise<void>(done => server.close(done)); await fixture.cleanup();
  }
});
it.each(['getAccessToken', 'refreshAccessToken'])('real auth %s cannot restore token or refresh timer after destroy', async method => {
  const fixture = await sdkFixture();
  const bot = new fixture.Bot({ appid: 'fixture', secret: 'fixture', mode: 'websocket', logLevel: 'off' });
  const auth = bot.sessionManager.authManager;
  let release!: (value: unknown) => void;
  auth.fetchNewToken = () => new Promise(done => { release = done; });
  try {
    const pending = auth[method](); const rejected = expect(pending).rejects.toThrow('destroyed');
    auth.destroy(); release({ access_token: 'fixture', expires_in: 7200 }); await rejected;
    expect(auth.currentToken).toBeUndefined(); expect(auth.refreshTimer).toBeUndefined();
    auth.scheduleTokenRefreshRetry(); expect(auth.refreshTimer).toBeUndefined();
    await expect(auth[method]()).rejects.toThrow('destroyed');
  } finally { auth.destroy(); await fixture.cleanup(); }
});
it('a replacement receiver start ignores the old gateway lookup', async () => {
  const fixture = await sdkFixture();
  const bot = new fixture.Bot({ appid: 'fixture', secret: 'fixture', mode: 'websocket', logLevel: 'off' });
  const releases: Array<(value: string) => void> = [];
  bot.sessionManager.userClose = false;
  bot.sessionManager.getWsUrl = () => new Promise<string>(done => releases.push(done));
  try {
    const old = bot.receiver.start(bot.sessionManager);
    const replacement = bot.receiver.start(bot.sessionManager);
    expect(releases).toHaveLength(2);
    releases[0]('ws://127.0.0.1:1'); await old;
    expect(bot.receiver.handler.ws).toBeUndefined();
    await bot.receiver.stop(bot.sessionManager);
    releases[1]('ws://127.0.0.1:1'); await replacement;
    expect(bot.receiver.handler.ws).toBeUndefined();
  } finally { await bot.stop(); bot.sessionManager.authManager.destroy(); await fixture.cleanup(); }
});
