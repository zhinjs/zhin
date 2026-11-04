import { createGithubSelfProfile } from '../src/self-profile.js';

const signal = new AbortController().signal;

describe('GitHub account self profile errors', () => {
  it('never falls back to /user for an App whose bot identity is unavailable', async () => {
    const request = vi.fn();
    const port = createGithubSelfProfile({ client: { isAppAuth: true, getBotIdentity: async () => null, request } as never, reportAccount: vi.fn() });
    await expect(port.read({ signal })).rejects.toThrow('App bot identity');
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps failed API status/message distinct from an absent account profile', async () => {
    const request = vi.fn(async () => ({ ok: false, status: 1, data: { message: 'Resource not accessible by integration' } }));
    const port = createGithubSelfProfile({ client: { isAppAuth: false, getBotIdentity: async () => null, request } as never, reportAccount: vi.fn() });
    await expect(port.read({ signal })).rejects.toThrow('GitHub self profile lookup failed (1): Resource not accessible by integration');
    expect(request).toHaveBeenCalledExactlyOnceWith({ method: 'GET', path: '/user', signal });
    const transport = new Error('CLI unavailable');
    request.mockRejectedValueOnce(transport);
    await expect(port.read({ signal })).rejects.toBe(transport);
  });
});
