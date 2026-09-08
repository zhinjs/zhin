// Runs from the clean installed project. This file must come from the pinned control workflow checkout.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { adapterFeatureId, isAdapterIndex } from 'zhin.js/adapter';
import { ImRuntime } from 'zhin.js/core/runtime';
import { NativeDevelopmentModuleRuntime, RootRuntime } from '@zhin.js/runtime';
import * as agent from '@zhin.js/agent';
assert.ok(Object.keys(agent).length > 0, 'Installed Agent entry must resolve');
const projectRoot = process.cwd();
const im = new ImRuntime();
const runtime = new RootRuntime({ projectRoot, modules: new NativeDevelopmentModuleRuntime({ projectRoot, watch: false }), environment: { name: 'test', mode: 'test', platform: 'node' }, config: { plugin: { terminal: { interactive: false } } }, installResources: ({ resources }) => im.install(resources) });
im.attach(runtime.snapshots);
let output = '';
const write = process.stdout.write;
process.stdout.write = function (chunk, ...args) { output += String(chunk); return write.call(this, chunk, ...args); };
try {
  const snapshot = await runtime.start();
  const adapters = snapshot.projections.get(adapterFeatureId);
  assert.ok(isAdapterIndex(adapters));
  const terminal = adapters.list().find(item => item.name === 'terminal');
  assert.ok(terminal, 'Minimal-bot terminal adapter must be ready');
  const endpoint = adapters.connection('terminal', 'terminal');
  assert.ok(endpoint);
  const receive = content => im.endpointEvents.receive(Object.freeze({ name: 'message.receive', payload: Object.freeze({ conversation: { endpoint: { id: String(terminal.id), adapter: String(terminal.id).split('\0')[0] }, kind: 'private', id: 'terminal' }, content }), endpoint: endpoint.identity, client: endpoint.client }));
  const hello = await receive('/hello');
  assert.equal(hello.matched, true);
  assert.equal(hello.command, 'hello');
  assert.ok(output.includes('Hello from minimal-bot.'));
  const card = await receive('/card');
  assert.equal(card.matched, true);
  assert.ok(output.includes('RSS'));
} finally {
  process.stdout.write = write;
  await runtime.stop();
}
fs.writeFileSync('smoke-result.json', JSON.stringify({ version: 1, candidateSha: process.env.CANDIDATE_SHA, artifactDigest: process.env.ARTIFACT_DIGEST, minimalBot: 'passed', terminalRoundTrip: 'passed', agentEntryImport: 'passed', stopped: true }));
