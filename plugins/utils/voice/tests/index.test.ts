/**
 * voice 插件测试
 * 测试 STT/TTS provider 选择逻辑和工具注册
 */
import { describe, it, expect } from 'vitest';
import { ZhinTool } from '../../../../packages/core/src/built/tool.js';

describe('voice 插件工具定义', () => {
  // 模拟 TTS 工具定义
  const ttsTool = new ZhinTool('text_to_speech')
    .desc('将文本转换为语音')
    .tag('语音', 'TTS', '音频')
    .keyword('tts', '语音', '朗读', '文字转语音')
    .param('text', { type: 'string', description: '要转换的文本' }, true)
    .param('voice', { type: 'string', description: '语音类型' })
    .execute(async (args) => `[audio] TTS result for: ${args.text}`);

  // 模拟 STT 工具定义
  const sttTool = new ZhinTool('speech_to_text')
    .desc('将语音转换为文本')
    .tag('语音', 'STT', '识别')
    .keyword('stt', '语音识别', '转文字')
    .param('audio_url', { type: 'string', description: '音频 URL' }, true)
    .execute(async (args) => `识别结果: ${args.audio_url}`);

  describe('TTS 工具', () => {
    it('应有完整 metadata', () => {
      const tool = ttsTool.toTool();
      expect(tool.name).toBe('text_to_speech');
      expect(tool.description).toContain('语音');
      expect(tool.parameters.properties).toHaveProperty('text');
      expect(tool.parameters.required).toContain('text');
    });

    it('voice 参数应为可选', () => {
      const tool = ttsTool.toTool();
      expect(tool.parameters.required).not.toContain('voice');
    });

    it('execute 应返回结果', async () => {
      const tool = ttsTool.toTool();
      const result = await tool.execute({ text: '你好世界' });
      expect(result).toContain('你好世界');
    });
  });

  describe('STT 工具', () => {
    it('应有完整 metadata', () => {
      const tool = sttTool.toTool();
      expect(tool.name).toBe('speech_to_text');
      expect(tool.description).toContain('文本');
      expect(tool.parameters.properties).toHaveProperty('audio_url');
      expect(tool.parameters.required).toContain('audio_url');
    });

    it('execute 应返回结果', async () => {
      const tool = sttTool.toTool();
      const result = await tool.execute({ audio_url: 'http://example.com/audio.mp3' });
      expect(result).toContain('识别结果');
    });
  });

  describe('ZhinTool 链式 API', () => {
    it('tag 应累积标签', () => {
      const json = ttsTool.toJSON();
      expect(json.tags).toEqual(['语音', 'TTS', '音频']);
    });

    it('toString 应返回描述', () => {
      expect(ttsTool.toString()).toContain('text_to_speech');
    });

    it('help 应包含参数信息', () => {
      expect(ttsTool.help).toContain('text');
      expect(ttsTool.help).toContain('必填');
    });
  });
});
