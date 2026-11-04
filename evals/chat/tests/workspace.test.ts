import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEvalWorkspace, loadEvalWorkspace } from '../src/workspace.js';
import { runtimeFixture, graphFixture, context } from '../../../packages/im/ai/tests/provider/fixtures.js';
import { openHeadlessInferenceHost } from '../../../basic/cli/src/plugin-runtime/inference/headless-host.js';

it('uses the supplied Host operation for actual Profile selection, execution and parameter evidence', async () => {
  const graph = graphFixture(); const f = runtimeFixture({ graph: { ...graph, profiles: { ...graph.profiles, text: { ...graph.profiles.text, parameters: { temperature: 0.42 } } } } });
  const scope = await f.runtime.openScope({ context }), close = vi.fn(() => scope.close());
  const workspace = createEvalWorkspace({ dir: '/synthetic', scope, defaultProfileId: 'text', close });
  try {
    const model = await workspace.model('text');
    expect(workspace.selection(model)).toMatchObject({ profile: 'text', nativeModel: 'text', profileParameters: { temperature: 0.42 }, graphRevision: 1 });
    expect((await workspace.runtime.complete(model, { systemPrompt: '', messages: [] })).content).toEqual([{ type: 'text', text: 'done' }]);
    await expect(workspace.model('alias/native')).rejects.toThrow('Profile ID');
    expect(() => workspace.runtime.complete({ ...model }, { messages: [] })).toThrow('this Host scope');
  } finally { await workspace.close(); f.runtime.retire(); }
  expect(close).toHaveBeenCalledOnce();
});

it('loads the persisted SQLite Profile through official headless Host without reading a nearby dotenv or making an authenticated request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eval-headless-'));
  const filename = join(directory, 'state.sqlite');
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
  vi.stubEnv('ZHIN_EVAL_MUST_NOT_READ_DOTENV', '');
  try {
    await writeFile(join(directory, 'zhin.config.yml'), `configVersion: 2\nplugins: {}\ndatabase:\n  dialect: sqlite\n  filename: ${JSON.stringify(filename)}\nai:\n  enabled: true\n`);
    await writeFile(join(directory, '.env'), 'ZHIN_EVAL_MUST_NOT_READ_DOTENV=synthetic-secret\n');
    const environment = await openHeadlessInferenceHost({ projectRoot: directory, database: { dialect: 'sqlite', filename }, resolveSource: () => undefined });
    try {
      const resource = { rootId: environment.host.rootId, ownerId: environment.host.hostOwnerId, revision: 1 };
      await environment.host.repository.commit({ rootId: resource.rootId, expectedRevision: 0, mutationId: 'setup', fingerprint: 'setup', result: null,
        graph: { rootId: resource.rootId, revision: 1,
          services: { service: { ...resource, id: 'service', driver: { id: 'openai', owner: 'root', contractVersion: '1' }, options: { baseUrl: 'https://api.openai.com/v1' }, models: { synthetic: { id: 'synthetic', kinds: ['language'], protocol: 'openai-chat', input: ['text'] } } } },
          accounts: { account: { ...resource, id: 'account', serviceId: 'service', incarnation: 'one', authentication: { method: 'api-key', source: 'env://ZHIN_EVAL_MUST_NOT_READ_DOTENV' } } },
          profiles: { selected: { ...resource, id: 'selected', accountId: 'account', model: 'synthetic', parameters: {} } }, purposes: { defaults: {} } } });
    } finally { await environment.close(); }
    const workspace = await loadEvalWorkspace(directory, { profileId: 'selected' });
    try {
      expect(workspace.agentModel).toBe('selected');
      const model = await workspace.model('selected');
      await expect(workspace.runtime.complete(model, { systemPrompt: '', messages: [] })).rejects.toBeInstanceOf(Error);
      expect(fetch).not.toHaveBeenCalled();
    } finally { await workspace.close(); }
  } finally { vi.unstubAllEnvs(); fetch.mockRestore(); await rm(directory, { recursive: true, force: true }); }
});
