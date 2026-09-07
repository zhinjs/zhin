// Trusted wrapper. Candidate code runs in this disposable container without control-plane state.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { adapterFeatureId, isAdapterIndex } from 'zhin.js/adapter';
import { ImRuntime } from 'zhin.js/core/runtime';
import { NativeDevelopmentModuleRuntime, RootRuntime } from '@zhin.js/runtime';
import * as agent from '@zhin.js/agent';
assert.ok(Object.keys(agent).length > 0);
const identity = JSON.parse(fs.readFileSync('canary.json', 'utf8'));
const projectRoot = process.cwd();
const im = new ImRuntime();
const runtime = new RootRuntime({ projectRoot, modules: new NativeDevelopmentModuleRuntime({ projectRoot, watch: false }), environment: { name: 'canary', mode: 'test', platform: 'node' }, config: { plugin: { terminal: { interactive: false } } }, installResources: ({ resources }) => im.install(resources) });
im.attach(runtime.snapshots);
const snapshot = await runtime.start();
const adapters = snapshot.projections.get(adapterFeatureId);
assert.ok(isAdapterIndex(adapters));
const terminal = adapters.list().find(item => item.name === 'terminal');
const endpoint = adapters.connection('terminal', 'terminal');
assert.ok(terminal && endpoint, 'Candidate Terminal must be ready');
let health = { ready: false, checkedAt: null, terminalRoundTrip: 'pending', agentEntryImport: 'passed' };
let stopping = false;
async function probe() {
  const originalWrite = process.stdout.write;
  let captured = '';
  process.stdout.write = function (chunk, ...args) { captured = (captured + String(chunk)).slice(-8192); return originalWrite.call(this, chunk, ...args); };
  try {
    const result = await im.endpointEvents.receive(Object.freeze({ name: 'message.receive', payload: Object.freeze({ conversation: { endpoint: { id: String(terminal.id), adapter: String(terminal.id).split('\0')[0] }, kind: 'private', id: 'terminal' }, content: '/hello' }), endpoint: endpoint.identity, client: endpoint.client }));
    assert.equal(result.matched, true); assert.equal(result.command, 'hello'); assert.ok(captured.includes('Hello from minimal-bot.'));
    health = { ready: true, checkedAt: new Date().toISOString(), terminalRoundTrip: 'passed', agentEntryImport: 'passed' };
  } catch { health = { ready: false, checkedAt: new Date().toISOString(), terminalRoundTrip: 'failed', agentEntryImport: 'passed' }; }
  finally { process.stdout.write = originalWrite; }
  if (!stopping) setTimeout(() => { void probe(); }, 30_000).unref();
}
void probe();
const server = http.createServer((request, response) => {
  if (request.method !== 'GET' || request.url !== '/health') { response.writeHead(404).end(); return; }
  const fresh = health.checkedAt && Date.now() - Date.parse(health.checkedAt) < 90_000;
  response.writeHead(health.ready && fresh ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({ identity, ...health, ready: Boolean(health.ready && fresh), scope: 'candidate-terminal-canary', sandboxRoundTrip: 'not-tested', controlPlane: false }));
});
server.listen(Number(process.env.PORT ?? 7860), '0.0.0.0');
async function stop() { stopping = true; server.close(); await runtime.stop(); }
process.once('SIGTERM', () => { void stop(); }); process.once('SIGINT', () => { void stop(); });
