import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { postSlackEphemeral } from '../src/slack-response-url.js';

describe('postSlackEphemeral', () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs ephemeral payload to response_url', () => {
    postSlackEphemeral('https://hooks.slack.com/cmd/abc', '处理中…');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.slack.com/cmd/abc',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response_type: 'ephemeral',
          text: '处理中…',
          replace_original: false,
        }),
      }),
    );
  });

  it('skips empty response_url', () => {
    postSlackEphemeral('', '处理中…');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
