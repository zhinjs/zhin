import { describe, expect, it } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import plugin from '../plugin.ts';
import shortenCommand from '../commands/shorten/[url:string].ts';
import expandCommand from '../commands/expand/[url:string].ts';
import { isValidUrl } from '../src/short-url-lib.js';

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
});
