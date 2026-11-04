import starTool from '../agents/github/skills/github-subscriptions/tools/star/index.js';
import prepareTool from '../agents/github/skills/github-repository/tools/prepare_workspace/index.js';
import { executeGithubSubscribe, executeGithubSubscriptions } from '../agents/github/skills/github-subscriptions/handlers.js';
import { executeGithubCreatePr, executeGithubPatchFile } from '../agents/github/skills/github-repository/handlers.js';
import { WorkspaceManager } from '../src/workspace-manager.js';

it('passes trusted tool locale to subscription and repository handlers', async () => {
  const api = { isStarred: vi.fn(async () => false) };
  const client = { getUserOrDefaultApi: async () => api };
  expect(await starTool.execute({ action: 'check', repo: 'team/repo' }, { $client: client, locale: 'en' } as never))
    .toBe('☆ Not starred: team/repo');
  await expect(prepareTool.execute({}, { $client: client, locale: 'en' } as never))
    .rejects.toThrow('No IM context');
});

it('localizes subscription feedback without translating repository or event values', async () => {
  const insert = vi.fn();
  const model = { select: () => ({ where: async () => [] }), insert };
  const client = { database: { models: new Map([['github_subscriptions', model]]) } };
  const message = { locale: 'en', clientAdapter: 'github', endpointId: 'app', sender: { id: 'person' }, conversation: { id: 'room', kind: 'channel' } };
  expect(await executeGithubSubscriptions({}, client as never, message as never)).toBe('📭 This channel has no GitHub subscriptions');
  const reply = await executeGithubSubscribe({ repo: 'team/repo', events: 'push,issue' }, client as never, message as never);
  expect(reply).toContain('Subscribed to team/repo');
  expect(reply).toContain('push, issue');
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ repo: 'team/repo', events: ['push', 'issue'], target_id: 'room' }));
});

it('localizes repository results while preserving provider errors and authored content', async () => {
  const message = { locale: 'en', conversation: { id: 'team/repo/issues/12' } };
  const api = { isAppAuth: true, getRepo: async () => ({ ok: true, data: { default_branch: 'trunk' } }),
    createPullRequest: vi.fn(async () => ({ ok: true, data: { number: 13, html_url: 'https://git.test/pr/13' } })),
    getFileContent: async () => ({ ok: false }), createOrUpdateFile: vi.fn(async () => ({ ok: false, data: { message: '服务端原文' } })) };
  const client = api;
  const created = await executeGithubCreatePr({ title: '作者标题', body: '正文' }, client as never, message as never);
  expect(created).toContain('PR #13 created');
  expect(api.createPullRequest).toHaveBeenCalledWith('team/repo', '作者标题', 'zhin/bot/issue-12', 'trunk', '正文');
  const failed = await executeGithubPatchFile({ path: 'file.txt', content: '内容', message: '提交说明' }, client as never, message as never);
  expect(failed).toContain('Failed to update the file:');
  expect(failed).toContain('服务端原文');
});

it('localizes workspace preflight failures before any git or token operation', async () => {
  const ensureInstallationTokenForRepo = vi.fn();
  const manager = new WorkspaceManager({ isAppAuth: false, ensureInstallationTokenForRepo } as never, '/unused');
  await expect(manager.ensureRepo('team/repo', 'en')).rejects.toThrow('GitHub App authentication is not configured');
  await expect(manager.commitAndPush('--upload-pack=x', 'main', 'text', 'en')).rejects.toThrow('Invalid repository name');
  await expect(manager.checkoutBranch('team/repo', '--unsafe', 'main', 'en')).rejects.toThrow('Invalid git ref');
  expect(ensureInstallationTokenForRepo).not.toHaveBeenCalled();
});
