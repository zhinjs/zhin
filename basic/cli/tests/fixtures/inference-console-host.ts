/** Synthetic browser acceptance Host. No installed workspace, platform, credential or supplier is used. */
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { createHttpHost } from '@zhin.js/host-http';
import { SnapshotStore, rootPluginId, type SnapshotState } from '@zhin.js/plugin-runtime';
import { aiProviderDefinitionsToken, type ProviderDefinition } from '@zhin.js/ai/provider';
import { registerConsoleSystemRoutes } from '../../src/plugin-runtime/console/system-routes.js';
import { createDatabaseHost } from '../../src/plugin-runtime/database-host-installer.js';
import { HostInference } from '../../src/plugin-runtime/inference/host.js';
import { registerInferenceRoutes } from '../../src/plugin-runtime/inference/routes.js';
import {
  InferenceApplyRejectedError,
  InferenceManagementError,
} from '../../src/plugin-runtime/inference/management.js';
import { resolveInferenceManagementPrincipal } from '../../src/plugin-runtime/inference/principal.js';
import { personalSessionOwnerId } from '@zhin.js/agent/personal-session';

const directory = await mkdtemp(join(tmpdir(), 'zhin-console-inference-fixture-'));
const database = createDatabaseHost({ dialect: 'sqlite', filename: join(directory, 'fixture.sqlite') });
const root = rootPluginId();
const serviceSchema = z.object({
  baseUrl: z.string().url(),
  compat: z.object({ strictTools: z.boolean().optional() }).optional(),
});
const parametersSchema = z.object({
  temperature: z.number().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});
const definition: ProviderDefinition<unknown, unknown> = {
  id: 'synthetic',
  label: '合成模型服务',
  contractVersion: '1',
  serviceSchema: { parse: (input) => serviceSchema.parse(input), inputSchema: z.toJSONSchema(serviceSchema) },
  profileSchema: ({ model }) => {
    const schema = model.kinds.includes('image')
      ? z.strictObject({ imageGeneration: z.strictObject({ aspectRatio: z.string().optional() }).optional() })
      : model.kinds.includes('language')
      ? parametersSchema
      : z.strictObject({});
    return { parse: (input) => schema.parse(input), inputSchema: z.toJSONSchema(schema) };
  },
  modelContracts: [
    { protocol: 'fixture-language', kinds: ['language'] },
    { protocol: 'fixture-decision', kinds: ['decision'] },
    { protocol: 'fixture-image', kinds: ['image'] },
  ],
  identity: (service) => ({ baseUrl: serviceSchema.parse(service.options).baseUrl }),
  authentication: {
    methods: ['api-key', 'oauth', 'none'],
    oauth: {
      contractVersion: '1',
      redirectUri: 'http://localhost:1455/auth/callback',
      begin: async () => ({
        authorizationUrl: 'http://localhost:1455/auth/callback?code=synthetic-code&state=synthetic-state',
        state: 'synthetic-state',
        privateState: { verifier: 'synthetic-private-verifier' },
      }),
      complete: async () => ({ accessToken: 'synthetic-test-token', refreshToken: 'synthetic-test-refresh' }),
      refresh: async () => {
        throw new Error('Synthetic fixture never refreshes a real account');
      },
    },
  },
  targets: () => ({ authentication: [], inference: [] }),
  models: (service) => service.models,
  discover: async () => [
    { id: 'synthetic-language', label: '合成聊天模型' },
    { id: 'synthetic-vision', label: '合成视觉模型' },
  ],
  createExecution: () => {
    throw new Error('Synthetic management fixture has no inference transport');
  },
};
const state: SnapshotState = {
  root,
  tree: new Map([
    [
      root,
      {
        id: root,
        instanceKey: 'root',
        packageName: 'synthetic-fixture',
        packageRoot: directory,
        children: [],
      },
    ],
  ]),
  config: new Map(),
  resources: new Map([[root, new Map([[aiProviderDefinitionsToken.id, [{ owner: root, definition }]]])]]),
  capabilities: new Map(),
  projections: new Map(),
};
const snapshots = new SnapshotStore(state);
const personal = {
  rootId: directory,
  platform: 'qq',
  endpoint: 'synthetic-account',
  adapterId: 'synthetic-adapter',
  subjectId: 'synthetic-member',
};
const inference = new HostInference({
  projectRoot: directory,
  database,
  snapshots: () => snapshots,
  resolveSource: () => {
    throw new Error('Synthetic fixture does not read any environment credentials');
  },
  personalOwners: [personal],
});
const operatorToken = 'synthetic-console-operator',
  memberToken = 'synthetic-console-member';
const http = createHttpHost({
  host: '127.0.0.1',
  port: Number(process.argv[2] ?? 0),
  token: operatorToken,
  tokens: [{ token: memberToken, scope: 'user', principalId: 'synthetic-member' }],
  corsOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:9000'],
});
registerConsoleSystemRoutes({ http, base: '/api', snapshot: () => snapshots.current });
let nextUnknown = false;
let nextRejected = false;
registerInferenceRoutes({
  http,
  base: '/api',
  acquire() {
    const lease = inference.acquireManagement(),
      apply = lease.management.apply.bind(lease.management);
    lease.management.apply = async (...input) => {
      if (nextRejected) {
        nextRejected = false;
        throw new InferenceApplyRejectedError(new InferenceManagementError('forbidden'));
      }
      const result = await apply(...input);
      if (nextUnknown && result.status === 'committed') {
        nextUnknown = false;
        return { status: 'commit-unknown' };
      }
      return result;
    };
    return lease;
  },
  principal: (input) =>
    resolveInferenceManagementPrincipal({
      ...input,
      hostOwnerId: inference.hostOwnerId,
      bindings: { 'synthetic-member': [personalSessionOwnerId(personal)] },
    }),
  owners: (input) =>
    input.scope === 'full'
      ? [{ id: inference.hostOwnerId, label: '合成部署模型', kind: 'host' }]
      : [{ id: personalSessionOwnerId(personal), label: '合成个人身份', kind: 'personal', personal }],
});
http.route('POST', '/fixture/next-save-unknown', (_request, response, _url, scope) => {
  if (scope !== 'full') {
    response.writeHead(403).end();
    return;
  }
  nextUnknown = true;
  response.writeHead(204).end();
});
http.route('POST', '/fixture/next-save-rejected', (_request, response, _url, scope) => {
  if (scope !== 'full') {
    response.writeHead(403).end();
    return;
  }
  nextRejected = true;
  response.writeHead(204).end();
});
await database.start();
const lease = inference.acquireManagement(),
  principal = { ownerId: inference.hostOwnerId, hostAdministrator: true };
const initial = await lease.management.review(principal, {
  plan: {
    version: 1,
    services: {
      synthetic: {
        driver: 'synthetic',
        label: '合成服务',
        options: { baseUrl: 'https://synthetic.invalid/v1' },
        models: {
          'synthetic-language': {
            id: 'synthetic-language',
            protocol: 'fixture-language',
            kinds: ['language'],
            input: ['text'],
            streaming: true,
            toolCalling: true,
          },
          'synthetic-vision': {
            id: 'synthetic-vision',
            protocol: 'fixture-language',
            kinds: ['language'],
            input: ['text', 'image'],
            streaming: true,
            toolCalling: true,
          },
          'synthetic-choice': { id: 'synthetic-choice', protocol: 'fixture-decision', kinds: ['decision'] },
          'synthetic-image': { id: 'synthetic-image', protocol: 'fixture-image', kinds: ['image'] },
        },
      },
    },
    accounts: {
      subscription: { service: 'synthetic', label: '合成订阅账号', auth: { method: 'oauth' } },
      local: { service: 'synthetic', label: '合成免密账号', auth: { method: 'none' } },
    },
    profiles: {
      chat: { account: 'local', model: 'synthetic-language', label: '日常聊天' },
      vision: { account: 'local', model: 'synthetic-vision', label: '看图' },
      decision: { account: 'local', model: 'synthetic-choice', label: '决策' },
      image: { account: 'local', model: 'synthetic-image', label: '图片生成' },
    },
    purposes: { chat: { profile: 'chat' }, perception: { profile: 'vision' }, image: { profile: 'image' } },
  },
});
await lease.management.apply(principal, { prepared: initial.prepared, mutationId: 'synthetic-initial' });
await lease.release();
const address = await http.listen();
process.stdout.write(
  JSON.stringify({ origin: address.origin, operatorToken, memberToken, temporaryData: directory }) + '\n'
);
let closing: Promise<void> | undefined;
function close(): Promise<void> {
  return (closing ??= (async () => {
    await http.close();
    await inference.close();
    await snapshots.close();
    await database.stop();
    await rm(directory, { recursive: true, force: true });
  })());
}
process.once('SIGINT', () => {
  void close().then(() => process.exit(0));
});
process.once('SIGTERM', () => {
  void close().then(() => process.exit(0));
});
