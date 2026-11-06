/** Synthetic native transport acceptance. Every request targets this script's loopback server. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { builtinAiProviders } from '@zhin.js/ai/providers';
import { SnapshotStore, rootPluginId } from '@zhin.js/plugin-runtime';
import { aiProviderDefinitionsToken } from '@zhin.js/ai/provider';
import { createDatabaseHost } from '@zhin.js/core/runtime';
import { createUserMessage } from '../../../../packages/im/ai/src/llm/types/agent-message.ts';
import { classifyProviderError } from '../../../../packages/im/ai/src/llm/provider-resilience.ts';

const { HostInference } = await import(
  process.argv[2]
    ? pathToFileURL(process.argv[2]).href
    : '@zhin.js/agent/runtime'
);
assert.equal(typeof globalThis.gc, 'function');
const rootDirectory = await mkdtemp(
  join(process.argv[3] ?? tmpdir(), 'inference-native-lifetime-')
);
const chunk = {
  id: 'probe',
  created: 1,
  model: 'local',
  choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null }],
};
let submitted = 0;
let notifyDiscoveryHeaders;
let notifyTokenHeaders;
const server = createServer(async (request, response) => {
  for await (const value of request) void value;
  submitted++;
  if (request.url === '/v1/chat/completions') {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  } else {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write(request.url === '/token' ? '{"access_token":' : '{"data":[');
  }
  if (request.url === '/v1/models') notifyDiscoveryHeaders?.();
  else if (request.url === '/token') notifyTokenHeaders?.();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const root = rootPluginId();
const oauth = {
  id: 'synthetic-oauth',
  contractVersion: '1',
  serviceSchema: { parse: (value) => value },
  models: () => ({}),
  targets: () => ({ authentication: [`${base}/token`], inference: [] }),
  authentication: {
    methods: ['oauth'],
    oauth: {
      contractVersion: '1',
      redirectUri: 'http://localhost:1455/auth/callback',
      begin: async () => ({
        authorizationUrl: `${base}/authorize`,
        state: 'synthetic-state',
        privateState: {},
      }),
      complete: async (input) => {
        const response = await input.fetch(`${base}/token`, {
          method: 'POST',
          body: 'synthetic=code',
          signal: input.signal,
        });
        const body = await response.json();
        return { accessToken: body.access_token };
      },
      refresh: async () => {
        throw new Error('No automatic OAuth retry in the native fixture');
      },
    },
  },
  createExecution: () => ({}),
};
const snapshots = new SnapshotStore({
  root,
  tree: new Map([
    [
      root,
      {
        id: root,
        instanceKey: 'root',
        packageName: 'native-transport-fixture',
        packageRoot: rootDirectory,
        children: [],
      },
    ],
  ]),
  config: new Map(),
  capabilities: new Map(),
  projections: new Map(),
  resources: new Map([
    [
      root,
      new Map([
        [
          aiProviderDefinitionsToken.id,
          [...builtinAiProviders, oauth].map((definition) => ({
            owner: root,
            definition,
          })),
        ],
      ]),
    ],
  ]),
});
const database = createDatabaseHost({
  dialect: 'sqlite',
  filename: ':memory:',
});
const facts = [];
const host = new HostInference({
  projectRoot: rootDirectory,
  database,
  snapshots: () => snapshots,
  personalOwners: [],
  resolveSource: () => {
    throw new Error('No environment credential in the fixture');
  },
  observeCredentialTransport: (fact) => {
    facts.push(fact);
  },
});
await database.start();
const principal = { ownerId: host.hostOwnerId, hostAdministrator: true };
let management;
async function collectGarbage() {
  for (let index = 0; index < 8; index++) {
    globalThis.gc();
    await delay(1);
  }
}
// Observe rejections before forcing GC; delayed assertions must not create a test-only unhandled rejection.
const observe = (promise) =>
  promise.then(
    (result) => ({ result }),
    (error) => ({ error })
  );
async function mustSettle(promise, label) {
  const value = await Promise.race([promise, delay(2000, 'pending')]);
  if (value === 'pending') console.error(`lifetime-not-settled: ${label}`);
  assert.notEqual(value, 'pending', `${label} did not retain cancellation through GC`);
  return value;
}
async function streamText(client, signal) {
  const run = await client.stream({
    request: {
      context: { systemPrompt: '', messages: [createUserMessage('synthetic')] },
    },
    signal,
  });
  const iterator = run[Symbol.asyncIterator]();
  let first;
  do {
    first = await iterator.next();
  } while (!first.done && first.value.type !== 'text_delta');
  assert.equal(first.value.type, 'text_delta');
  return iterator;
}
try {
  management = host.acquireManagement();
  const plan = await management.management.review(principal, {
    plan: {
      version: 1,
      services: {
        local: {
          driver: 'openai-compatible',
          options: { baseUrl: `${base}/v1` },
          models: {
            local: {
              id: 'local',
              protocol: 'openai-chat',
              kinds: ['language'],
              input: ['text'],
              streaming: true,
              toolCalling: true,
            },
          },
        },
        oauth: { driver: 'synthetic-oauth', options: {}, models: {} },
      },
      accounts: {
        local: { service: 'local', auth: { method: 'api-key' } },
        oauth: { service: 'oauth', auth: { method: 'oauth' } },
      },
      profiles: {
        local: {
          account: 'local',
          model: 'local',
          parameters: { chunkTimeoutMs: 100, maxRetries: 0 },
        },
      },
      purposes: { chat: { profile: 'local' } },
    },
  });
  assert.equal(
    (
      await management.management.apply(principal, {
        prepared: plan.prepared,
        mutationId: 'graph',
      })
    ).status,
    'committed'
  );
  const accountId = plan.bindings.accounts.local,
    oauthId = plan.bindings.accounts.oauth;
  async function putKey(revision) {
    const key = await management.management.prepareKey(principal, {
      accountId,
      expectedRevision: revision,
      key: 'synthetic-loopback-key',
    });
    assert.equal(
      (
        await management.management.apply(principal, {
          prepared: key.prepared,
          mutationId: `key-${revision}`,
        })
      ).status,
      'committed'
    );
  }
  await putKey(0);
  const lease = snapshots.acquire(),
    runtime = host.createInference(lease);
  const scope = await runtime.openScope({
    context: {
      rootId: host.rootId,
      hostOwnerId: host.hostOwnerId,
      ownerId: host.hostOwnerId,
      operationId: 'native-gc',
      sessionKey: 'synthetic',
    },
  });
  try {
    const unused = await scope.client.stream({
      request: {
        context: { systemPrompt: '', messages: [createUserMessage('unused')] },
      },
    });
    await collectGarbage();
    assert.equal(submitted, 0);
    await unused.close();
    const timed = await streamText(scope.client);
    const next = observe(timed.next());
    await collectGarbage();
    const timeout = await mustSettle(next, 'Host SDK stream timeout');
    assert.ok(timeout.error);
    assert.equal(classifyProviderError(timeout.error).kind, 'timeout');
    const stopped = await streamText(scope.client);
    const ending = observe(stopped.next());
    await collectGarbage();
    const account = await management.management.account(principal, accountId);
    await host.accounts.disconnect({
      account,
      expectedRevision: 1,
      authContractVersion: '1',
    });
    assert.ok((await mustSettle(ending, 'Host account disconnect')).error);
  } finally {
    await scope.close();
    runtime.retire();
    lease.release();
  }
  await putKey(2);
  const discoveryController = new AbortController();
  const discoveryHeaders = new Promise((resolve) => { notifyDiscoveryHeaders = resolve; });
  const discovery = observe(
    management.management.discover(principal, { accountId }, discoveryController.signal)
  );
  await discoveryHeaders;
  await delay(10);
  await collectGarbage();
  discoveryController.abort(new Error('synthetic discovery cancelled'));
  assert.ok((await mustSettle(discovery, 'Host discovery response')).error);
  const authAccount = await management.management.account(principal, oauthId);
  const login = await host.accounts.beginLogin({
    account: authAccount,
    signal: new AbortController().signal,
  });
  const controller = new AbortController();
  const tokenHeaders = new Promise((resolve) => { notifyTokenHeaders = resolve; });
  const completing = observe(
    host.accounts.completeLogin({
      account: authAccount,
      loginId: login.loginId,
      code: 'synthetic-code',
      state: login.state,
      signal: controller.signal,
    })
  );
  await tokenHeaders;
  await delay(10);
  await collectGarbage();
  controller.abort(new Error('synthetic OAuth cancelled'));
  assert.ok((await mustSettle(completing, 'Host OAuth complete response')).error);
  assert.equal(submitted, 4);
  assert.equal(facts.filter((fact) => fact.phase === 'transport-attempted').length, 3);
  console.log('host-native-gc-stream-disconnect-discovery-oauth-passed');
} finally {
  await management?.release();
  await host.close();
  await snapshots.close();
  await database.stop();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(rootDirectory, { recursive: true, force: true });
}
