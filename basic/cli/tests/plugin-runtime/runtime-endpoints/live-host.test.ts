import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../../../..');

// Use Node's HTTP client to exercise the built Host independently of the test
// runner's global fetch/Undici socket configuration.
async function localRequest(url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; ok: boolean; json(): Promise<any> }>((resolve, reject) => {
    const client = request(url, { method: options.method, headers: options.headers, timeout: 2000 }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode!, ok: response.statusCode! >= 200 && response.statusCode! < 300,
        json: async () => JSON.parse(body) }));
    });
    client.on('error', reject);
    client.on('timeout', () => client.destroy(new Error('Local Host request timed out')));
    client.end(options.body);
  });
}

it('manages and restores accounts through the built CLI without restarting its process or rewriting startup files', async () => {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-account-built-host-')));
  let child: ReturnType<typeof spawn> | undefined, output = '';
  const source = JSON.stringify({ configVersion: 2, http: { host: '127.0.0.1', port: 0, token: 'synthetic-admin' } });
  const environment = 'SYNTHETIC_ACCOUNT_FIXTURE=unchanged\n';
  const headers = { authorization: 'Bearer synthetic-admin', 'content-type': 'application/json' };
  async function stop() {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  }
  async function start() {
    output = '';
    child = spawn(process.execPath, [join(repoRoot, 'basic/cli/bin/zhin.js'), 'runtime', 'start'], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.on('data', data => { output += String(data); }); child.stderr!.on('data', data => { output += String(data); });
    const host = await new Promise<string>((done, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Synthetic account Host did not activate: ${output}`)), 20000);
      const check = () => { const address = /listening (http:\/\/127\.0\.0\.1:\d+)/u.exec(output)?.[1]; if (address) { clearTimeout(timeout); done(address); } };
      child!.stdout!.on('data', check); child!.stderr!.on('data', check);
      child!.once('exit', () => { clearTimeout(timeout); reject(new Error(`Synthetic account Host exited: ${output}`)); }); check();
    });
    const deadline = Date.now() + 15000;
    while (!(await localRequest(`${host}/pub/ready`)).ok) {
      if (Date.now() > deadline || child.exitCode !== null) throw new Error(`Synthetic account Host not ready: ${output}`);
      await new Promise(done => setTimeout(done, 50));
    }
    return host;
  }
  const rpc = async (host: string, method: string, data: Record<string, unknown> = {}) => {
    const response = await localRequest(`${host}/api/console/request`, { method: 'POST', headers, body: JSON.stringify({ type: `plugin.root.accounts-${method}`, data }) });
    expect(response.status, output).toBe(200);
    const body = await response.json(); expect(body.success, JSON.stringify(body)).toBe(true); return body.data;
  };
  try {
    await mkdir(join(project, 'node_modules/@zhin.js'), { recursive: true });
    await symlink(join(repoRoot, 'packages/im/zhin'), join(project, 'node_modules/zhin.js'), 'dir');
    await symlink(join(repoRoot, 'packages/im/adapter'), join(project, 'node_modules/@zhin.js/adapter'), 'dir');
    await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'account-built-fixture', private: true, type: 'module',
      dependencies: { 'zhin.js': 'workspace:*', '@zhin.js/adapter': 'workspace:*' },
      zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', engine: '^1.0.0', runtime: 'trusted', features: [{ package: '@zhin.js/adapter', api: '^1.0.0' }], plugins: [] } }));
    await writeFile(join(project, 'plugin.ts'), `import {definePlugin,definePluginConsoleRpc,pluginConsoleRpcToken} from 'zhin.js';
import {Adapter,defineAdapter,createAdapterConsoleRpc,createEndpointSpecification,endpointSpec} from 'zhin.js/adapter';
let created=0;
class NativeClient {constructor(){created++;}}
class NativeEndpoint extends NativeClient {[endpointSpec]=createEndpointSpecification(this,{start(){},open(){},close(){},stop(){},send:async()=> 'mid'});}
class Channel extends Adapter {get configurationUpdateFields(){return ['label','password'];}get configurationIdentityFields(){return ['id'];}createEndpoint(){return new NativeEndpoint();}}
export default definePlugin({name:'account-built-fixture',setup(ctx){
ctx.addAdapter('account',defineAdapter({capabilities:['inbound','outbound'],createAdapter:()=>new Channel()}));
const accounts=createAdapterConsoleRpc({adapterKey:'account',adapterDisplayName:'Synthetic account',readPermission:'account:read',writePermission:'account:write',fields:[{key:'label'},{key:'password',env:true}]},ctx.resources);
const actions={};for(const name of ['add','update','start','stop','remove','replace'])actions['accounts-'+name]={requiredPermissions:['account:write'],handler:(input,call)=>accounts.methods.get('endpoint-'+name).handler(input,call)};
ctx.resources.provide(pluginConsoleRpcToken,definePluginConsoleRpc({queries:{'accounts-status':{requiredPermissions:['account:read'],handler:(input,call)=>accounts.methods.get('status').handler(input,call)},'accounts-created':{requiredPermissions:['account:read'],handler:()=>({created})}},actions}));
}});\n`);
    await writeFile(join(project, 'zhin.config.json'), source); await writeFile(join(project, '.env'), environment);
    const host = await start(), pid = child!.pid;
    let status = await rpc(host, 'status'); const generation = status.runtime.generation;
    expect(status.runtime.canManage).toBe(true); expect(status.runtime.needsMigration).toBe(true);
    const legacy = status.runtime.endpoints[0];
    expect((await rpc(host, 'created')).created).toBe(1);
    await rpc(host, 'add', { expectedGeneration: generation, expectedRevision: status.runtime.revision, confirmMigration: true,
      id: 'new-account', values: { password: 'synthetic-new-account-secret', label: 'one' } });
    status = await rpc(host, 'status'); const added = status.runtime.endpoints.find((item: { endpointId: string }) => item.endpointId === 'new-account');
    expect(added.desiredEnabled).toBe(false); expect((await rpc(host, 'created')).created).toBe(1);
    await rpc(host, 'start', { expectedGeneration: generation, expectedRevision: status.runtime.revision, instanceId: added.instanceId });
    await vi.waitFor(async () => { status = await rpc(host, 'status'); expect(status.runtime.endpoints.find((item: { instanceId: string }) => item.instanceId === added.instanceId).started).toBe(true); });
    const started = status.runtime.endpoints.find((item: { instanceId: string }) => item.instanceId === added.instanceId);
    await rpc(host, 'update', { expectedGeneration: generation, expectedRevision: status.runtime.revision, instanceId: added.instanceId, values: { label: 'two' } });
    await vi.waitFor(async () => { status = await rpc(host, 'status'); expect(status.runtime.endpoints.find((item: { instanceId: string; retiring?: boolean }) => item.instanceId === added.instanceId && !item.retiring).started).toBe(true); });
    expect(status.runtime.endpoints.find((item: { instanceId: string; retiring?: boolean }) => item.instanceId === added.instanceId && !item.retiring).incarnationId).not.toBe(started.incarnationId);
    expect(status.runtime.endpoints.find((item: { instanceId: string }) => item.instanceId === legacy.instanceId).incarnationId).toBe(legacy.incarnationId);
    expect((await rpc(host, 'created')).created).toBe(3);
    await rpc(host, 'stop', { expectedGeneration: generation, expectedRevision: status.runtime.revision, instanceId: added.instanceId });
    await vi.waitFor(async () => { status = await rpc(host, 'status'); expect(status.runtime.endpoints.find((item: { instanceId: string; retiring?: boolean }) => item.instanceId === added.instanceId && !item.retiring).desiredEnabled).toBe(false); });
    const revision = status.runtime.revision;
    expect(child!.pid).toBe(pid); expect(child!.exitCode).toBeNull(); expect(status.runtime.generation).toBe(generation);
    expect(await readFile(join(project, 'zhin.config.json'), 'utf8')).toBe(source); expect(await readFile(join(project, '.env'), 'utf8')).toBe(environment);
    await stop(); const second = await start(); expect(child!.pid).not.toBe(pid);
    const restored = await rpc(second, 'status'); expect(restored.runtime.revision).toBe(revision);
    expect(restored.runtime.endpoints.find((item: { instanceId: string }) => item.instanceId === added.instanceId)).toMatchObject({ canonicalId: added.canonicalId, desiredEnabled: false, started: false });
    expect((await rpc(second, 'created')).created).toBe(1);
    expect(await readFile(join(project, 'zhin.config.json'), 'utf8')).toBe(source); expect(await readFile(join(project, '.env'), 'utf8')).toBe(environment);
    // A Host without atomic persistence retains its existing static-account path.
    await stop();
    const memorySource = JSON.stringify({ ...JSON.parse(source), database: { dialect: 'memory' } });
    await writeFile(join(project, 'zhin.config.json'), memorySource);
    const staticHost = await start(), staticStatus = await rpc(staticHost, 'status');
    expect(staticStatus.runtime.canManage).toBe(false);
    expect(staticStatus.runtime.endpoints).toHaveLength(1);
    expect((await rpc(staticHost, 'created')).created).toBe(1);
    expect(await readFile(join(project, 'zhin.config.json'), 'utf8')).toBe(memorySource);
    expect(await readFile(join(project, '.env'), 'utf8')).toBe(environment);
  } catch (error) { throw new Error(`Built synthetic account Host failed: ${output}`, { cause: error }); }
  finally { await stop(); await rm(project, { recursive: true, force: true }); }
}, 60000);
