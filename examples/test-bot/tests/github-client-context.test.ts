import { describe, expect, it, vi } from 'vitest';
import { resolveGithubEndpoint } from '../lib/github-api.js';
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
