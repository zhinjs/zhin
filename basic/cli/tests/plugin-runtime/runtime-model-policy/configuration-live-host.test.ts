import { spawn } from 'node:child_process';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

const repoRoot = resolve(import.meta.dirname, '../../../../..');

it.each([
  { name: 'mixed model/HTTP with config watch', watch: true },
  { name: 'mixed model/HTTP with explicit Console apply', watch: false },
  { name: 'new environment key keeps the dependent model pending', watch: true, environment: 'new' },
  { name: 'same-name environment rotation keeps the dependent model pending', watch: true, environment: 'rotation' },
])('$name', async ({ watch, environment }) => {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-config-model-live-')));
  const requests: Array<{ model: string; authorization?: string }> = [];
  let holdNext = false, heldResponse: ServerResponse | undefined, heldModel = '';
  let markHeld!: () => void;
  const held = new Promise<void>(done => { markHeld = done; });
  const complete = (response: ServerResponse, model: string) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: 'synthetic', object: 'chat.completion', created: 1, model,
      choices: [{ index: 0, message: { role: 'assistant', content: model }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  };
  const provider = createServer(async (request, response) => {
    let text = ''; for await (const chunk of request) text += chunk;
    const body = JSON.parse(text);
    requests.push({ model: body.model, authorization: request.headers.authorization });
    if (holdNext) { holdNext = false; heldResponse = response; heldModel = body.model; markHeld(); }
    else complete(response, body.model);
  });
  await new Promise<void>((done, reject) => { provider.once('error', reject); provider.listen(0, '127.0.0.1', done); });
  let child: ReturnType<typeof spawn> | undefined, output = '';
  let inFlight: Promise<Response> | undefined;
  const initialEnvironment = environment ? 'CONFIG_LIVE_KEY=synthetic-initial-key\nSYNTHETIC_SENTINEL=unchanged\n'
    : 'SYNTHETIC_SENTINEL=unchanged\n';
  const desiredEnvironment = environment === 'new' ? initialEnvironment + 'CONFIG_LIVE_NEW_KEY=synthetic-changed-key\n'
    : environment === 'rotation' ? 'CONFIG_LIVE_KEY=synthetic-changed-key\nSYNTHETIC_SENTINEL=unchanged\n' : initialEnvironment;
  const document = { configVersion: 2, http: { host: '127.0.0.1', port: 0, token: 'synthetic-admin' },
    ai: { providers: { local: { sdk: 'openai-compatible', apiKey: environment ? '${CONFIG_LIVE_KEY}' : 'synthetic-initial-key',
      baseUrl: `http://127.0.0.1:${(provider.address() as AddressInfo).port}/v1`, models: ['initial', 'changed'], contextWindow: 4096 } },
      agents: { zhin: { provider: 'local', model: 'initial' } } } };
  const file = join(project, 'zhin.config.json');
  try {
    await mkdir(join(project, 'node_modules/@zhin.js'), { recursive: true });
    for (const [name, path] of [['zhin.js', 'packages/im/zhin'], ['@zhin.js/agent', 'packages/im/agent'], ['@zhin.js/tool', 'packages/im/tool']]) {
      await symlink(join(repoRoot, path!), join(project, 'node_modules', name!), 'dir');
    }
    await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'configuration-model-fixture', private: true, type: 'module',
      dependencies: { 'zhin.js': 'workspace:*', '@zhin.js/agent': 'workspace:*', '@zhin.js/tool': 'workspace:*' },
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', engine: '^1.0.0', runtime: 'trusted',
        features: [{ package: '@zhin.js/tool', api: '^1.0.0' }], plugins: [] } }));
    await writeFile(join(project, 'plugin.ts'), `import {definePlugin,aiCompletionToken} from 'zhin.js';
import {createServer} from 'node:http';
export default definePlugin({name:'configuration-model-fixture',setup(ctx){
const completion=ctx.resources.use(aiCompletionToken);
const server=createServer(async(req,res)=>{try{const result=await completion.completeText({purpose:'synthetic-config-test',prompt:req.url==='/hold'?'hold':'hello'});res.setHeader('content-type','application/json');res.end(JSON.stringify(result));}catch(error){res.writeHead(503);res.end(JSON.stringify({error:error instanceof Error?error.message:'failed'}));}});
server.listen(0,'127.0.0.1',()=>console.log('MODEL_CONSUMER http://127.0.0.1:'+server.address().port));
ctx.lifecycle.add(()=>new Promise(done=>{server.closeAllConnections();server.close(done);}));
}});\n`);
    await writeFile(file, JSON.stringify(document));
    await writeFile(join(project, '.env'), initialEnvironment);
    // Production exports throughout: test the built CLI, not a mixture of lib and development sources.
    child = spawn(process.execPath, [join(repoRoot, 'basic/cli/bin/zhin.js'), 'runtime', 'start', ...(watch ? ['--watch', 'config'] : [])],
      { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] });
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
    const readyDeadline = Date.now() + 15000;
    while (!(await fetch(`${addresses.host}/pub/ready`, { signal: AbortSignal.timeout(2000) })).ok) {
      if (Date.now() > readyDeadline || child.exitCode !== null) throw new Error(`Synthetic Host did not become ready: ${output}`);
      await new Promise(done => setTimeout(done, 25));
    }
    const headers = { authorization: 'Bearer synthetic-admin', 'content-type': 'application/json' };
    const rpc = async (message: unknown) => {
      const response = await fetch(`${addresses.host}/api/console/request`, { method: 'POST', headers, body: JSON.stringify(message), signal: AbortSignal.timeout(8000) });
      const result = await response.json(); expect(response.status, JSON.stringify(result)).toBe(200); expect(result.success).toBe(true); return result.data;
    };
    const consume = async () => {
      const response = await fetch(addresses.consumer, { signal: AbortSignal.timeout(8000) });
      const result = await response.json(); expect(response.status, `${JSON.stringify(result)} ${output}`).toBe(200); return result;
    };
    const before = await rpc({ type: 'config:get-source', requestId: 'before' });
    const pid = child.pid;
    expect((await consume()).model).toBe('initial');
    holdNext = true;
    inFlight = fetch(addresses.consumer + '/hold', { signal: AbortSignal.timeout(25000) });
    void inFlight.catch(() => undefined);
    await held;
    const desired = { ...document, http: environment ? document.http : { ...document.http, port: 65001 }, ai: { ...document.ai,
      providers: { local: { ...document.ai.providers.local, apiKey: environment === 'new' ? '${CONFIG_LIVE_NEW_KEY}'
        : environment === 'rotation' ? '${CONFIG_LIVE_KEY}' : 'synthetic-changed-key' } },
      agents: { zhin: { provider: 'local', model: 'changed' } } } };
    if (environment) {
      await writeFile(join(project, '.env.next'), desiredEnvironment);
      await rename(join(project, '.env.next'), join(project, '.env'));
    }
    await writeFile(file + '.next', JSON.stringify(desired)); await rename(file + '.next', file);
    if (!watch) {
      const edited = await rpc({ type: 'config:get-source', requestId: 'edited' });
      expect(edited.revision).not.toBe(before.revision);
      expect((await consume()).model).toBe('initial');
      const applied = await rpc({ type: 'config:replace-source', requestId: 'apply', source: edited.source, expectedRevision: edited.revision });
      expect(applied.restartRequired).toBe(true);
    }
    let applied = await rpc({ type: 'config:get-source', requestId: 'application' });
    const deadline = Date.now() + 15000;
    while (!applied.application?.groups.some((group: { id: string; status: string }) => group.id === 'agent-models'
      && (environment || group.status === 'applied'))) {
      if (Date.now() > deadline || child.exitCode !== null) throw new Error(`Model config did not apply: ${JSON.stringify(applied.application)} ${output}`);
      await new Promise(done => setTimeout(done, 25));
      applied = await rpc({ type: 'config:get-source', requestId: 'application' });
    }
    if (environment) {
      expect(applied.application.groups).toContainEqual(expect.objectContaining({ id: 'environment', effect: 'restart-process',
        status: 'restart-pending', reasonCode: 'environment-host-consumers' }));
      expect(applied.application.groups).toContainEqual(expect.objectContaining({ id: 'agent-models', effect: 'restart-process',
        status: 'restart-pending', reasonCode: 'model-environment-pending' }));
      expect(JSON.parse(applied.source)).toEqual(desired);
      for (const secret of ['synthetic-initial-key', 'synthetic-changed-key']) {
        expect(JSON.stringify(applied)).not.toContain(secret);
      }
    } else {
      expect(applied.application.groups).toContainEqual(expect.objectContaining({ effect: 'restart-process', status: 'restart-pending', paths: expect.arrayContaining([['http', 'port']]) }));
    }
    expect((await consume()).model).toBe(environment ? 'initial' : 'changed');
    expect(heldModel).toBe('initial'); complete(heldResponse!, heldModel); heldResponse = undefined;
    expect((await (await inFlight).json()).model).toBe('initial');
    expect(requests.at(-1)).toEqual(environment ? { model: 'initial', authorization: 'Bearer synthetic-initial-key' }
      : { model: 'changed', authorization: 'Bearer synthetic-changed-key' });
    expect(requests.slice(0, 2).every(request => request.authorization === 'Bearer synthetic-initial-key')).toBe(true);
    expect(child.pid).toBe(pid); expect(child.exitCode).toBeNull();
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(desired);
    expect(await readFile(join(project, '.env'), 'utf8')).toBe(desiredEnvironment);
    if (environment) for (const secret of ['synthetic-initial-key', 'synthetic-changed-key']) expect(output).not.toContain(secret);
  } finally {
    if (heldResponse) complete(heldResponse, heldModel);
    await inFlight?.catch(() => undefined);
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    provider.closeAllConnections(); await new Promise<void>(done => provider.close(() => done()));
    await rm(project, { recursive: true, force: true });
  }
}, 60000);
