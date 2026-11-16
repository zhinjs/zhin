import { describe, it, expect } from 'vitest';
import {
  TOOL_MEDIA_SENT_NOTE,
  extractMediaElementsFromToolCalls,
  mergeToolOutboundElements,
  omitInlineBinaryForModel,
  splitToolResultMedia,
} from '../../src/media/media-tool-bridge.js';

describe('extractMediaElementsFromToolCalls', () => {
  it('sends a published image once when the final reply already includes it', () => {
    const url = 'https://images.example.test/generated/example.gif';
    const output = mergeToolOutboundElements([{ type: 'message', segments: [{ type: 'image', data: { media: { kind: 'url', value: url } } }] }],
      [{ tool: 'generate_image', result: JSON.stringify({ image_url: url }) }]);
    expect(output).toHaveLength(1);
  });
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

describe('#1250 batch 29: tool media never reaches the model', () => {
  const audio = Buffer.alloc(19_000, 7).toString('base64');

  it('splits voice_tts audio into outbound media and leaves only metadata for the model', () => {
    const split = splitToolResultMedia('voice_tts', { audio, format: 'mp3', size: 19_000 });
    expect(JSON.stringify(split.output)).not.toContain(audio.slice(0, 64));
    expect(split.output).toMatchObject({ format: 'mp3', size: 19_000, sent: true, note: TOOL_MEDIA_SENT_NOTE });
    expect(split.media).toEqual([{ type: 'audio', url: `data:audio/mpeg;base64,${audio}`, base64: audio }]);
    // The record the reply is built from carries the media once; the result text has no audio left.
    const once = extractMediaElementsFromToolCalls([{ tool: 'voice_tts', result: JSON.stringify(split.output), media: split.media }]);
    expect(once).toHaveLength(1);
  });

  it('splits a JSON string result and inline generate_image bytes the same way', () => {
    const image = Buffer.alloc(4000, 1).toString('base64');
    const voice = splitToolResultMedia('voice_tts', JSON.stringify({ audio: 'AQID', format: 'wav' }));
    expect(voice.output).toMatchObject({ format: 'wav', size: 3, sent: true });
    expect(voice.media[0]).toMatchObject({ type: 'audio', url: 'data:audio/wav;base64,AQID' });
    const generated = splitToolResultMedia('generate_image', JSON.stringify({ image, mime: 'image/jpeg', model: 'm' }));
    expect(JSON.stringify(generated.output)).not.toContain(image.slice(0, 64));
    expect(generated.output).toMatchObject({ model: 'm', mime: 'image/jpeg', sent: true });
    expect(generated.media).toEqual([{ type: 'image', url: `data:image/jpeg;base64,${image}`, base64: image }]);
  });

  it('leaves failures, published image URLs and other tools unchanged', () => {
    const failure = { error: '语音合成失败: 未找到 edge-tts' };
    expect(splitToolResultMedia('voice_tts', failure)).toEqual({ output: failure, media: [] });
    const published = JSON.stringify({ image_url: 'https://images.example/a.png' });
    expect(splitToolResultMedia('generate_image', published)).toEqual({ output: published, media: [] });
    const other = { audio };
    expect(splitToolResultMedia('some_tool', other)).toEqual({ output: other, media: [] });
  });

  it('omits data URLs and long base64 runs from any model-facing text', () => {
    const text = `{"file":"data:audio/mpeg;base64,${audio}","raw":"${audio}","short":"aGVsbG8=","id":"abc123"}`;
    const shown = omitInlineBinaryForModel(text);
    expect(shown).not.toContain(audio.slice(0, 64));
    expect(shown).toContain('已省略内嵌 audio/mpeg 数据');
    expect(shown).toContain('已省略 base64 数据');
    expect(shown).toContain('"short":"aGVsbG8="');
    expect(shown).toContain('"id":"abc123"');
    expect(omitInlineBinaryForModel('普通文本 https://example.com/a.png')).toBe('普通文本 https://example.com/a.png');
  });

  it('does not send a copied inline voice from the reply as a second audio message', () => {
    const copied = audio.slice(0, 2000);
    const output = mergeToolOutboundElements([
      { type: 'message', segments: [{ type: 'text', data: { text: '好的' } }, { type: 'audio', data: { media: { kind: 'base64', value: copied } } }] },
      { type: 'audio', url: `data:audio/mpeg;base64,${copied}` },
    ], [{ tool: 'voice_tts', result: '{"sent":true}', media: [{ type: 'audio', url: `data:audio/mpeg;base64,${audio}`, base64: audio }] }]);
    const audios = output.filter(element => element.type === 'audio');
    expect(audios).toEqual([{ type: 'audio', url: `data:audio/mpeg;base64,${audio}`, base64: audio }]);
    expect(output[0]).toEqual({ type: 'message', segments: [{ type: 'text', data: { text: '好的' } }] });
  });

  it('keeps model-authored inline media when no tool produced media of that kind', () => {
    const reply = [{ type: 'message' as const, segments: [{ type: 'audio', data: { media: { kind: 'base64', value: 'AQID' } } }] }];
    expect(mergeToolOutboundElements(reply, [])).toEqual(reply);
    const withImage = mergeToolOutboundElements(reply, [{ tool: 'generate_image', result: JSON.stringify({ image_url: 'https://images.example/a.png' }) }]);
    expect(withImage[0]).toEqual(reply[0]);
  });
});
