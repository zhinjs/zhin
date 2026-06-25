import type { SpeechPipelineForRichSegment } from './rich-segments/types.js';
import { createWarnOnce, resetWarnOnceForTests } from '@zhin.js/logger';

/** 动态 import 时使用的包名（与 @zhin.js/speech package.json 一致） */
export const SPEECH_PACKAGE = '@zhin.js/speech';

export interface LoadSpeechPipelineOptions {
  getConfig?: () => Record<string, unknown> | undefined;
  warn?: (message: string) => void;
}

let cached: SpeechPipelineForRichSegment | null | undefined;
const speechPeerWarnOnce = createWarnOnce('speech');

/** 动态加载 @zhin.js/speech；未安装时 warn 一次并返回 undefined */
export async function loadSpeechPipeline(
  opts?: LoadSpeechPipelineOptions,
): Promise<SpeechPipelineForRichSegment | undefined> {
  if (cached !== undefined) {
    return cached ?? undefined;
  }

  try {
    const mod = await import(SPEECH_PACKAGE);
    const speechConfig = opts?.getConfig?.()?.speech as Record<string, unknown> | undefined;
    cached = mod.createSpeechPipeline(speechConfig) as SpeechPipelineForRichSegment;
    return cached;
  } catch {
    speechPeerWarnOnce(
      opts?.warn,
      `未安装 ${SPEECH_PACKAGE}，STT/TTS 已降级。安装: pnpm add ${SPEECH_PACKAGE}`,
    );
    cached = null;
    return undefined;
  }
}

/** 测试用：重置加载缓存 */
export function resetSpeechLoaderForTests(): void {
  cached = undefined;
  resetWarnOnceForTests('speech');
}

export type { SpeechPipelineForRichSegment };
