import { describe, it, expect } from 'vitest';
import { extractMediaElementsFromToolCalls } from '../../src/media/media-tool-bridge.js';

describe('extractMediaElementsFromToolCalls', () => {
  it('voice_tts 结果应转为 AudioElement', () => {
    const els = extractMediaElementsFromToolCalls([
      { tool: 'voice_tts', result: { audio: 'YWFh', format: 'mp3' } },
    ]);
    expect(els).toHaveLength(1);
    expect(els[0].type).toBe('audio');
    if (els[0].type === 'audio') {
      expect(els[0].base64).toBe('YWFh');
    }
  });

  it('generate_image 结果应转为 ImageElement', () => {
    const els = extractMediaElementsFromToolCalls([
      {
        tool: 'generate_image',
        result: JSON.stringify({ image: 'iVBORw0KGgo=', mime: 'image/png', model: 'cogview-3-flash' }),
      },
    ]);
    expect(els).toHaveLength(1);
    expect(els[0].type).toBe('image');
    if (els[0].type === 'image') {
      expect(els[0].base64).toBe('iVBORw0KGgo=');
      expect(els[0].url).toContain('data:image/png;base64,');
    }
  });
});
