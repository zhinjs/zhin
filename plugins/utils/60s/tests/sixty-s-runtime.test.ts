import { describe, expect, it } from 'vitest';
import { parseCommandDefinition } from '@zhin.js/command';
import { formatList } from '../src/api.js';
import plugin from '../plugin.ts';
import weatherTool from '../agent/tools/weather.ts';
import newsTool from '../agent/tools/60s_news.ts';
import weatherCommand from '../commands/weather/[city:string].ts';
import newsCommand from '../commands/60s.ts';

describe('@zhin.js/plugin-60s', () => {
  it('defines Plugin Runtime entry as sixty-s', () => {
    expect(plugin.name).toBe('sixty-s');
  });

  it('exposes agent tools via defineAgentTool authoring surface', () => {
    // Canonical tool definitions live under agent/tools/ (tags/keywords per README);
    // there is no duplicate top-level tools/ directory.
    expect(typeof weatherTool.execute).toBe('function');
    expect(typeof newsTool.execute).toBe('function');
    expect(weatherTool.description).toContain('天气');
    expect(weatherTool.keywords).toContain('weather');
  });

  it('exposes chat commands', () => {
    expect(parseCommandDefinition(weatherCommand)).toBe(weatherCommand);
    expect(parseCommandDefinition(newsCommand)).toBe(newsCommand);
  });

  it('formats hot lists', () => {
    const result = formatList([
      { title: '热搜1', hot: '100万' },
      { title: '热搜2', hot: '50万' },
    ]);
    expect(result).toContain('1. 热搜1');
    expect(result).toContain('🔥100万');
    expect(formatList([], 5)).toBe('');
  });
});
