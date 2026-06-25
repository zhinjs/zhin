import { readFile } from 'node:fs/promises';
import { ZhinTool } from '@zhin.js/core';
import type { Plugin } from '@zhin.js/core';
import type { SpeechPipeline, TtsProviderId } from '@zhin.js/speech';

/**
 * 安装 @zhin.js/speech 后注册 IM 侧能力：speech Context、voice_stt / voice_tts 工具。
 */
export function registerSpeechImIntegration(
  plugin: Plugin,
  pipeline: SpeechPipeline,
): () => void {
  plugin.provide({
    name: 'speech',
    description: 'STT/TTS speech pipeline',
    value: pipeline,
  });

  const toolService = plugin.root.inject('tool' as keyof Plugin.Contexts) as
    | { addTool: (tool: ZhinTool, pluginName: string) => void }
    | undefined;

  if (!toolService) {
    plugin.logger.debug('speech: tool 服务未启用，跳过 voice_stt / voice_tts');
    return () => {};
  }

  const sttTool = new ZhinTool('voice_stt')
    .desc('将语音/音频消息转写为文字')
    .keyword('语音转文字', '语音识别', 'stt', 'transcribe', '听')
    .tag('voice', 'stt', '语音')
    .param('audio_url', { type: 'string', description: '音频文件 URL' })
    .param('file_path', { type: 'string', description: '本地音频绝对路径（MCP 落盘场景）' })
    .execute(async (args: Record<string, unknown>) => {
      const audioUrl = typeof args.audio_url === 'string' ? args.audio_url : '';
      const filePath = typeof args.file_path === 'string' ? args.file_path : '';
      if (!audioUrl && !filePath) {
        return { error: '需要提供 audio_url 或 file_path' };
      }
      try {
        let buffer: Buffer;
        let mimeType = 'audio/wav';
        if (filePath) {
          buffer = await readFile(filePath);
        } else {
          const response = await fetch(audioUrl);
          if (!response.ok) throw new Error(`下载音频失败: ${response.status}`);
          buffer = Buffer.from(await response.arrayBuffer());
          mimeType = response.headers.get('content-type') || mimeType;
        }
        const text = await pipeline.transcribe({ data: buffer, mimeType });
        return { text: text || '(无法识别语音内容)' };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `语音识别失败: ${msg}` };
      }
    });

  const ttsTool = new ZhinTool('voice_tts')
    .desc('将文字转换为语音消息')
    .keyword('文字转语音', '语音合成', 'tts', '朗读', '读出来')
    .tag('voice', 'tts', '语音')
    .param('text', { type: 'string', description: '要转换为语音的文字内容' }, true)
    .param('voice', { type: 'string', description: '语音类型（覆盖默认配置）' })
    .param('provider', {
      type: 'string',
      description: 'TTS provider：edge | openai | azure | custom',
      enum: ['edge', 'openai', 'azure', 'custom'],
    })
    .execute(async (args: Record<string, unknown>) => {
      const text = typeof args.text === 'string' ? args.text : '';
      if (!text) return { error: '需要提供 text' };
      try {
        const provider = typeof args.provider === 'string'
          ? args.provider as TtsProviderId
          : undefined;
        const voice = typeof args.voice === 'string' ? args.voice : undefined;
        const result = await pipeline.synthesize({ text, voice, provider });
        const base64 = result.data.toString('base64');
        return {
          audio: base64,
          format: result.format,
          size: result.data.length,
          message: `语音合成完成 (${(result.data.length / 1024).toFixed(1)} KB)`,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `语音合成失败: ${msg}` };
      }
    });

  toolService.addTool(sttTool, 'speech');
  toolService.addTool(ttsTool, 'speech');
  plugin.logger.debug('speech: voice_stt / voice_tts 工具已注册');

  return () => {};
}
