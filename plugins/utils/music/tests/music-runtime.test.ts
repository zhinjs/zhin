import { describe, expect, it } from 'vitest';
import { parseComponentDefinition } from '@zhin.js/component';
import { parseAgentToolDefinition } from '@zhin.js/tool';
import plugin from '../plugin.ts';
import shareMusic from '../components/share-music.ts';
import searchTool from '../tools/music-search.ts';
import shareTool from '../tools/music-share.ts';
import { formatMusicInfo } from '../src/config.js';

describe('@zhin.js/plugin-music', () => {
  it('defines a valid Plugin Runtime entry', () => {
    expect(plugin.name).toBe('music');
  });

  it('brands component and tools', () => {
    expect(parseComponentDefinition(shareMusic)).toBe(shareMusic);
    expect(parseAgentToolDefinition(searchTool)).toBe(searchTool);
    expect(parseAgentToolDefinition(shareTool)).toBe(shareTool);
  });

  it('formats music info lines', () => {
    expect(formatMusicInfo({
      title: 'Song',
      artist: 'Artist',
      source: 'qq',
      duration: 125,
    })).toContain('Song');
  });
});
