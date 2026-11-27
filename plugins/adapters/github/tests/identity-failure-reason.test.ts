/** #1250 b111: a failed GitHub identity verification says why, without credentials. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GhClient, githubErrorMessage, redactGithubSecrets } from '../src/gh-client.js';
import { GithubAdapter } from '../src/adapter.js';

const PEM = '-----BEGIN RSA PRIVATE KEY-----\nMIIEsecretbody\n-----END RSA PRIVATE KEY-----';

describe('GitHub identity verification failure reason', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('includes the verification message and masks credentials', async () => {
    vi.spyOn(GhClient.prototype, 'verifyAuth').mockResolvedValue({ ok: false, user: '',
      message: 'App Token 验证失败 (401): A JSON web token could not be decoded eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOjF9.sig' });
    const adapter = new GithubAdapter({} as never) as unknown as {
      identifyConfiguration(config: unknown, signal: AbortSignal, changed: readonly string[]): Promise<string | undefined>;
    };
    const error = await adapter.identifyConfiguration({ id: 'gh', app_id: 1, private_key: PEM }, new AbortController().signal, [])
      .catch((cause: unknown) => cause as Error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('GitHub application identity verification failed: App Token 验证失败 (401): A JSON web token could not be decoded ***');
  });

  it('reads the GitHub error body message and masks keys and tokens', () => {
    expect(githubErrorMessage('{"message":"Bad credentials","documentation_url":"https://docs.github.com"}')).toBe('Bad credentials');
    expect(githubErrorMessage('')).toBe('unknown');
    expect(redactGithubSecrets(`key ${PEM} token ghs_abcdefghijklmnop Bearer abcdefghijk`, [PEM]))
      .toBe('key *** token *** Bearer ***');
    expect(redactGithubSecrets('-----BEGIN PRIVATE KEY-----\nabc', [])).toBe('***');
  });
});
