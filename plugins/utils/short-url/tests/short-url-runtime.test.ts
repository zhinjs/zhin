import { describe, expect, it, vi } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import plugin from '../plugin.ts';
import shortenCommand from '../commands/shorten/[url:string].ts';
import expandCommand from '../commands/expand/[url:string].ts';
import { expandUrl, isValidUrl } from '../src/short-url-lib.js';

describe('@zhin.js/plugin-short-url', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('short-url');
  });

  it('brands shorten and expand commands', () => {
    expect(parseCommandDefinition(shortenCommand)).toBe(shortenCommand);
    expect(parseCommandDefinition(expandCommand)).toBe(expandCommand);
  });

  it('validates http(s) urls', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('ftp://example.com')).toBe(false);
    expect(isValidUrl('not-a-url')).toBe(false);
  });

  it('rejects invalid url in shorten command', async () => {
    const result = await shortenCommand.execute({
      owner: {} as never,
      generation: 0,
      config: {},
      use: () => {
        throw new Error('unused');
      },
      args: [],
      params: { url: 'bad' },
      input: undefined,
    });
    expect(result).toBe('请提供有效的 HTTP/HTTPS 链接');
  });

  it('expands a short url by following redirects', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      url: 'https://example.com/landing',
      headers: new Headers(),
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(expandUrl('https://is.gd/abc')).resolves.toBe('https://example.com/landing');
      expect(fetchMock).toHaveBeenCalledWith('https://is.gd/abc', { redirect: 'follow' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns the original url when no redirect happens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      url: 'https://example.com/page',
      headers: new Headers(),
    })));
    try {
      await expect(expandUrl('https://example.com/page')).resolves.toBe('https://example.com/page');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws when the final response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 404,
      url: 'https://example.com/page',
      headers: new Headers(),
    })));
    try {
      await expect(expandUrl('https://example.com/page')).rejects.toThrow('无法展开链接 (404)');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
