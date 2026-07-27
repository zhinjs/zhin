import { seedSpeechPipeline, type Plugin } from '@zhin.js/core';

import type { AppConfig } from '../types.js';
import { registerSpeechImIntegration } from './speech-im.js';

/**
 * 可选 @zhin.js/speech：voice_stt / voice_tts 工具、speech Context。
 * 入站 STT 由 agent preprocessInboundMedia + core loadSpeechPipeline 处理。
 */
export async function registerSpeech(
  plugin: Plugin,
  appConfig: AppConfig,
): Promise<void> {
  try {
    const { createSpeechPipeline } = await import('@zhin.js/speech');
    const speechConfig = (appConfig.speech ?? {}) as import('@zhin.js/speech').SpeechConfig;
    const pipeline = createSpeechPipeline(speechConfig, plugin.logger);
    seedSpeechPipeline(pipeline);

    plugin.onDispose(registerSpeechImIntegration(plugin, pipeline));
  } catch (err) {
    // 只有「包未安装」才降级为警告跳过；其余错误（配置错误、初始化 bug 等）原样抛出
    if ((err as NodeJS.ErrnoException | undefined)?.code === 'ERR_MODULE_NOT_FOUND') {
      plugin.logger.warn(
        '未安装 @zhin.js/speech，已跳过 voice_stt/voice_tts。安装: pnpm add @zhin.js/speech',
      );
      return;
    }
    throw err;
  }
}
