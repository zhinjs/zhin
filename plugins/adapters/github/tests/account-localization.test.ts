import { afterEach, describe, expect, it, vi } from 'vitest';
import { GhClient } from '../src/gh-client.js';
import { executeGithubBind, executeGithubInstall, executeGithubWhoami } from '../agents/github/skills/github-account/handlers.js';
import installTool from '../agents/github/skills/github-account/tools/install/index.js';

afterEach(() => vi.restoreAllMocks());

describe('GitHub account localization', () => {
  it('uses the trusted tool language without translating installation metadata', async () => {
    const client = { appSlug: 'team-app', host: 'github.example.test', installations: [{ account: { login: '中文团队', type: 'Organization' } }] };
    const result = await installTool.execute({}, { $client: client, locale: 'en' } as never);
    expect(result).toContain('Install the GitHub App');
    expect(result).toContain('https://github.example.test/apps/team-app/installations/new');
    expect(result).toContain('中文团队');
    expect(await executeGithubInstall({} as never, 'zh-CN')).toBe('❌ Endpoint 未配置 GitHub App');
  });

  it('captures the binding language before the asynchronous authorization result', async () => {
    let finish!: (result: { access_token: string }) => void;
    vi.spyOn(GhClient, 'deviceFlowRequestCode').mockResolvedValue({ device_code: 'synthetic-device', user_code: 'TEST-CODE', verification_uri: 'https://github.example.test/device', interval: 5, expires_in: 600 });
    vi.spyOn(GhClient, 'deviceFlowPollToken').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    vi.spyOn(GhClient.prototype, 'verifyAuth').mockResolvedValue({ ok: true, user: 'fixture-user', message: '' });
    vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const insert = vi.fn(async () => undefined);
    const model = { select: () => ({ where: async () => [] }), insert };
    const client = { clientId: 'synthetic-client', host: 'github.example.test', database: { models: new Map([['github_oauth_users', model]]) } };
    const message = { clientAdapter: 'github', sender: { id: 'sender-1' }, locale: 'en' as 'en' | 'zh-CN', $reply: vi.fn(async () => undefined) };
    const prompt = await executeGithubBind({}, client as never, message as never, 'en');
    expect(prompt).toContain('Open this link in a browser');
    expect(prompt).toContain('TEST-CODE');
    message.locale = 'zh-CN';
    finish({ access_token: 'synthetic-access-token' });
    await vi.waitFor(() => expect(message.$reply).toHaveBeenCalledWith('✅ GitHub account linked!\n👤 fixture-user'));
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('localizes account guidance without inventing a command invocation', async () => {
    const client = { database: { models: new Map([['github_oauth_users', { select: () => ({ where: async () => [] }) }]]) } };
    const message = { clientAdapter: 'github', sender: { id: 'u1' }, locale: 'en' };
    expect(await executeGithubWhoami({}, client as never, message as never, 'en')).toBe('📭 No GitHub account is linked.\n🔗 Start account linking first.');
  });
});
