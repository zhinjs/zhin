import { describe, expect, it, vi } from 'vitest';
import { resolveGhClient, resolveGithubEndpoint } from '../lib/github-api.js';
import { requireOauthModel } from '../lib/github-oauth.js';

describe('test-bot GitHub client access', () => {
  it('resolves the configured GitHub endpoint from the current generation projection', () => {
    const client = { name: 'zhin-dev' };
    const endpointClient = vi.fn((adapter: string, endpointKey: string) => {
      expect(adapter).toBe('github');
      expect(endpointKey).toBe('zhin-dev');
      return client;
    });
    const project = vi.fn(() => ({
      $projection: 'zhin.adapter-index/1',
      client: endpointClient,
    }));

    expect(resolveGithubEndpoint({ project } as never)).toBe(client);
    expect(endpointClient).toHaveBeenCalledOnce();
  });

  it('resolves the user GitHub API from the endpoint bound to the current generation', async () => {
    const getUserOrDefaultApi = vi.fn(async () => ({ login: 'alice' }));
    const endpointClient = vi.fn(() => ({ getUserOrDefaultApi }));
    const project = vi.fn(() => ({
      $projection: 'zhin.adapter-index/1',
      client: endpointClient,
    }));

    await expect(resolveGhClient({
      project,
      input: { $adapter: 'icqq', $sender: { id: '10001' } },
    } as never)).resolves.toEqual({ login: 'alice' });
    expect(getUserOrDefaultApi).toHaveBeenCalledWith('icqq', '10001');
  });

  it('returns a readable projection error instead of consulting a process-global adapter', async () => {
    const project = vi.fn(() => {
      throw new Error('GitHub endpoint is offline');
    });
    const context = { project, input: undefined } as never;

    expect(resolveGithubEndpoint(context)).toBe('GitHub endpoint is offline');
    await expect(resolveGhClient(context)).resolves.toBe('GitHub endpoint is offline');
  });

  it('reads OAuth models from the GitHub Plugin owner database', () => {
    const model = { select: vi.fn() };
    const endpoint = {
      database: {
        started: true,
        models: { get: vi.fn(() => model) },
      },
    };

    expect(requireOauthModel(endpoint as never)).toBe(model);
    expect(endpoint.database.models.get).toHaveBeenCalledWith('github_oauth_users');
  });
});
