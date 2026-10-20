export { createSpeechPipeline } from './pipeline.js';
export { resolveTtsProvider } from './tts/index.js';
export type {
  SpeechConfig,
  SpeechLogger,
  SpeechPipeline,
  STTConfig,
  TTSConfig,
  TranscribeInput,
  TtsProvider,
  TtsProviderId,
  TtsSynthesizeInput,
  TtsSynthesizeResult,
  SttProviderId,
} from './types.js';

/** 动态 import 时使用的包名（与 package.json name 一致） */
export const SPEECH_PACKAGE = '@zhin.js/speech';
