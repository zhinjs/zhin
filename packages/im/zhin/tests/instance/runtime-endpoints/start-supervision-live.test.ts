import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../../../../..');

async function localRequest(url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; ok: boolean; json(): Promise<any> }>((done, reject) => {
    const client = request(url, { method: options.method, headers: options.headers, timeout: 2000 }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('error', reject);
      response.on('end', () => done({ status: response.statusCode!, ok: response.statusCode! >= 200 && response.statusCode! < 300,
        json: async () => JSON.parse(body) }));
    });
    client.on('error', reject);
    client.on('timeout', () => client.destroy(new Error('Local Host request timed out')));
    client.end(options.body);
  });
}

/**
 * #1250: an account whose start waits on a LoginAssist challenge must not hold back instance
 * readiness; the Console login flow answers it after ready and the account comes online.
 */
it('becomes ready while an account start waits on a login challenge, then brings the account online after submit', async () => {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-start-supervision-')));
  let child: ReturnType<typeof spawn> | undefined, output = '';
  const headers = { authorization: 'Bearer synthetic-admin', 'content-type': 'application/json' };
  try {
    const adapterManifest = JSON.parse(await readFile(join(repoRoot, 'packages/im/adapter/package.json'), 'utf8'));
    await mkdir(join(project, 'node_modules/@zhin.js'), { recursive: true });
    await symlink(join(repoRoot, 'packages/im/zhin'), join(project, 'node_modules/zhin.js'), 'dir');
    await symlink(join(repoRoot, 'packages/im/adapter'), join(project, 'node_modules/@zhin.js/adapter'), 'dir');
    await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'start-supervision-fixture', private: true, type: 'module',
      dependencies: { 'zhin.js': 'workspace:*', '@zhin.js/adapter': 'workspace:*' },
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', engine: '^1.0.0', runtime: 'trusted',
        features: [{ package: '@zhin.js/adapter', api: `^${adapterManifest.zhin.featureApi}` }], plugins: [] } }));
    // The Endpoint's start raises a challenge and waits for the person's answer (like ICQQ device lock).
    await writeFile(join(project, 'plugin.ts'), `import {definePlugin} from 'zhin.js';
import {Adapter,defineAdapter,createEndpointSpecification,endpointSpec} from 'zhin.js/adapter';
import {loginAssistToken} from 'zhin.js/core/runtime';
class Native {}
class AssistEndpoint extends Native {
  #state='idle';
  constructor(assist,identity){super();this[endpointSpec]=createEndpointSpecification(this,{
    start:async(signal)=>{this.#state='connecting';
      const flow=assist.beginFlow({adapter:'assist',endpointKey:'assist',owner:this,signal,endpointIdentity:identity});
      await flow.challenge({kind:'device',title:'Device lock',input:{kind:'code',label:'Code'}},{timeoutMs:0});
      flow.outcome({result:'online'});this.#state='open';},
    open(){},close(){},stop:()=>{this.#state='stopped';},send:async()=>'mid',
    get transportState(){return self.#state;}});const self=this;}
}
class AssistAdapter extends Adapter {
  constructor(assist){super();this.assist=assist;}
  createEndpoint(_config,context){return new AssistEndpoint(this.assist,{canonicalId:context.canonicalId,instanceId:context.instanceId,epoch:context.epoch,incarnationId:context.incarnationId});}
}
export default definePlugin({name:'start-supervision-fixture',setup(ctx){
ctx.addAdapter('assist',defineAdapter({capabilities:['inbound','outbound'],login:{mode:'interactive',challenges:['device']},
  createAdapter:(context)=>new AssistAdapter(context.use(loginAssistToken))}));
}});\n`);
    await writeFile(join(project, 'zhin.config.json'), JSON.stringify({ configVersion: 2, http: { host: '127.0.0.1', port: 0 } }));
    child = spawn(process.execPath, [join(repoRoot, 'basic/cli/bin/zhin.js'), 'runtime', 'start', '--standalone'], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.on('data', data => { output += String(data); }); child.stderr!.on('data', data => { output += String(data); });
    const host = await new Promise<string>((done, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Host did not listen: ${output}`)), 20000);
      const check = () => { const address = /listening (http:\/\/127\.0\.0\.1:\d+)/u.exec(output)?.[1]; if (address) { clearTimeout(timeout); done(address); } };
      child!.stdout!.on('data', check); child!.stderr!.on('data', check);
      child!.once('exit', () => { clearTimeout(timeout); reject(new Error(`Host exited: ${output}`)); }); check();
    });
    // host.start() returns although the account start never finishes on its own.
    const deadline = Date.now() + 20000;
    while (!(await localRequest(`${host}/pub/ready`)).ok) {
      if (Date.now() > deadline || child.exitCode !== null) throw new Error(`Host not ready: ${output}`);
      await new Promise(done => setTimeout(done, 50));
    }
    const ready = await (await localRequest(`${host}/pub/ready`)).json();
    expect(ready).toEqual({ ready: true });
    const rpc = async (type: string, data: Record<string, unknown> = {}) => {
      const response = await localRequest(`${host}/api/console/request`, { method: 'POST', headers, body: JSON.stringify({ type, requestId: 1, ...data }) });
      expect(response.status, output).toBe(200);
      return response.json();
    };
    const readiness = async () => (await (await localRequest(`${host}/api/system/readiness`, { headers })).json()).data;
    let details = await readiness();
    expect(details.ready).toBe(true);
    expect(details.endpoints).toEqual([expect.objectContaining({ name: 'assist', phase: 'starting', attempt: 1 })]);
    const listed = await rpc('endpoint.list');
    expect(listed.data.endpoints).toEqual([expect.objectContaining({ phase: 'awaiting_assist', connected: false, startAttempt: 1 })]);
    const flows = await rpc('login.flow.list');
    expect(flows.data.count).toBe(1);
    const pending = await rpc('login.list');
    const taskId = pending.data.tasks[0]?.id;
    expect(taskId, JSON.stringify(pending)).toBeTypeOf('string');
    const submitted = await rpc('login.submit', { taskId, adapter: 'assist', endpointKey: 'assist', value: { action: 'submit', values: { input: '123456' } } });
    expect(submitted.success, JSON.stringify(submitted)).toBe(true);
    await vi.waitFor(async () => {
      details = await readiness();
      expect(details.endpoints).toEqual([expect.objectContaining({ name: 'assist', phase: 'online', attempt: 0 })]);
    }, { timeout: 10000, interval: 100 });
    const online = await rpc('endpoint.list');
    expect(online.data.endpoints).toEqual([expect.objectContaining({ phase: 'online', connected: true })]);
    // The public probe never discloses account state.
    expect(await (await localRequest(`${host}/pub/ready`)).json()).toEqual({ ready: true });
  } catch (error) { throw new Error(`Start supervision Host failed: ${output}`, { cause: error }); }
  finally {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    await rm(project, { recursive: true, force: true });
  }
}, 60000);
