import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../../../..');

it('changes the next default completion without changing PID/generation/files and restores the policy in a rebuilt Host', async () => {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-runtime-model-live-')));
  const requests: string[] = [];
  const provider = createServer(async (request, response) => {
    let text = ''; for await (const chunk of request) text += chunk;
    const body = JSON.parse(text); requests.push(body.model);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: 'fixture', object: 'chat.completion', created: 1, model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: body.model }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise<void>(done => provider.listen(0, '127.0.0.1', done));
  let child: ReturnType<typeof spawn> | undefined, output = '';
  const source = JSON.stringify({ configVersion: 2, http: { host: '127.0.0.1', port: 0, token: 'synthetic-admin' },
    ai: { providers: { local: { sdk: 'openai-compatible', apiKey: 'synthetic-provider-key', baseUrl: `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`, models: ['initial', 'changed'], contextWindow: 4096 } },
      agents: { zhin: { provider: 'local', model: 'initial' } } } });
  const environment = 'SYNTHETIC_FIXTURE_SENTINEL=unchanged\n';
  async function stop() {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  }
  async function start() {
    output = '';
    child = spawn(process.execPath, [join(repoRoot, 'basic/cli/bin/zhin.js'), 'runtime', 'start'], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.on('data', chunk => { output += String(chunk); }); child.stderr!.on('data', chunk => { output += String(chunk); });
    const addresses = await new Promise<{ host: string; consumer: string }>((done, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Synthetic Host did not activate: ${output}`)), 20000);
      const check = () => {
        const host = /listening (http:\/\/127\.0\.0\.1:\d+)/u.exec(output)?.[1];
        const consumer = /MODEL_CONSUMER (http:\/\/127\.0\.0\.1:\d+)/u.exec(output)?.[1];
        if (host && consumer) { clearTimeout(timeout); done({ host, consumer }); }
      };
      child!.stdout!.on('data', check); child!.stderr!.on('data', check);
      child!.once('exit', () => { clearTimeout(timeout); reject(new Error(`Synthetic Host exited: ${output}`)); }); check();
    });
    const deadline = Date.now() + 15000;
    while (!(await fetch(`${addresses.host}/pub/ready`, { signal: AbortSignal.timeout(2000) })).ok) {
      if (Date.now() > deadline || child.exitCode !== null) throw new Error(`Synthetic Host did not become ready: ${output}`);
      await new Promise(done => setTimeout(done, 50));
    }
    return addresses;
  }
  try {
    await mkdir(join(project, 'node_modules/@zhin.js'), { recursive: true });
    for (const [name, packagePath] of [['zhin.js', 'packages/im/zhin'], ['@zhin.js/agent', 'packages/im/agent'], ['@zhin.js/tool', 'packages/im/tool']]) {
      await symlink(join(repoRoot, packagePath!), join(project, 'node_modules', name!), 'dir');
    }
    await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'runtime-model-fixture', private: true, type: 'module',
      dependencies: { 'zhin.js': 'workspace:*', '@zhin.js/agent': 'workspace:*', '@zhin.js/tool': 'workspace:*' },
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', engine: '^1.0.0', runtime: 'trusted', features: [{ package: '@zhin.js/tool', api: '^1.0.0' }], plugins: [] } }));
    await writeFile(join(project, 'plugin.ts'), `import {definePlugin,aiCompletionToken} from 'zhin.js';
import {createServer} from 'node:http';
export default definePlugin({name:'runtime-model-fixture',setup(ctx){
const completion=ctx.resources.use(aiCompletionToken);
const server=createServer(async(req,res)=>{try{const result=await completion.completeText({purpose:'synthetic-policy-test',prompt:'hello',...(req.url==='/?explicit'?{agent:'zhin'}:{})});res.setHeader('content-type','application/json');res.end(JSON.stringify(result));}catch{res.writeHead(503);res.end('{}');}});
server.listen(0,'127.0.0.1',()=>console.log('MODEL_CONSUMER http://127.0.0.1:'+server.address().port));
ctx.lifecycle.add(()=>new Promise(done=>{server.closeAllConnections();server.close(done);}));
}});\n`);
    await writeFile(join(project, 'zhin.config.json'), source); await writeFile(join(project, '.env'), environment);
    const first = await start(), pid = child!.pid;
    const headers = { authorization: 'Bearer synthetic-admin', 'content-type': 'application/json' };
    const topology = async (host: string) => (await (await fetch(`${host}/console/api/topology`, { headers })).json()).generation;
    const generation = await topology(first.host); expect(Number.isSafeInteger(generation)).toBe(true);
    expect((await (await fetch(first.consumer)).json()).model).toBe('initial');
    const listed = await fetch(`${first.host}/api/agent/model-policy`, { headers }); expect(listed.status, output).toBe(200);
    const initial = (await listed.json()).data;
    const selected = initial.presets.find((preset: { model: string }) => preset.model === 'changed').id;
    const saved = await fetch(`${first.host}/api/agent/model-policy`, { method: 'PUT', headers,
      body: JSON.stringify({ expectedRevision: initial.revision, refsOverride: { defaults: { chat: selected } } }) });
    expect(saved.status, output).toBe(200); const next = (await saved.json()).data; expect(next.revision).toBe(1);
    expect((await (await fetch(first.consumer)).json()).model).toBe('changed');
    expect((await (await fetch(first.consumer + '/?explicit')).json()).model).toBe('initial');
    expect(child!.pid).toBe(pid); expect(child!.exitCode).toBeNull(); expect(await topology(first.host)).toBe(generation);
    expect(await readFile(join(project, 'zhin.config.json'), 'utf8')).toBe(source); expect(await readFile(join(project, '.env'), 'utf8')).toBe(environment);
    await stop(); const second = await start(); expect(child!.pid).not.toBe(pid);
    const restored = await fetch(`${second.host}/api/agent/model-policy`, { headers }); expect(restored.status, output).toBe(200);
    expect((await restored.json()).data).toMatchObject({ revision: 1, refsOverride: { defaults: { chat: selected } } });
    expect((await (await fetch(second.consumer)).json()).model).toBe('changed');
    expect(requests).toEqual(['initial', 'changed', 'initial', 'changed']);
    expect(await readFile(join(project, 'zhin.config.json'), 'utf8')).toBe(source); expect(await readFile(join(project, '.env'), 'utf8')).toBe(environment);
  } finally { await stop(); provider.closeAllConnections(); await new Promise<void>(done => provider.close(() => done())); await rm(project, { recursive: true, force: true }); }
}, 60000);
