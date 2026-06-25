export type SttProviderId = 'ollama' | 'openai';
export type TtsProviderId = 'edge' | 'openai' | 'azure' | 'custom';

export interface STTConfig {
  enabled?: boolean;
  provider?: SttProviderId;
  model?: string;
  host?: string;
  apiKey?: string;
}

export interface TTSConfig {
  enabled?: boolean;
  provider?: TtsProviderId;
  voice?: string;
  model?: string;
  host?: string;
  apiKey?: string;
  /** edge-tts */
  rate?: string;
  pitch?: string;
  edgeTtsCommand?: string;
  /** azure */
  region?: string;
  subscriptionKey?: string;
  /** custom OpenAI-compatible */
  baseUrl?: string;
  headers?: Record<string, string>;
  speed?: number;
}

export interface SpeechConfig {
  stt?: STTConfig;
  tts?: TTSConfig;
}

export interface TtsSynthesizeInput {
  text: string;
  voice?: string;
  format?: 'mp3' | 'wav';
  speed?: number;
  provider?: TtsProviderId;
}

export interface TtsSynthesizeResult {
  data: Buffer;
  format: 'mp3' | 'wav';
}

export interface TtsProvider {
  readonly id: TtsProviderId;
  synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult>;
}

export interface TranscribeInput {
  data: Buffer;
  mimeType?: string;
}

export interface SpeechPipeline {
  transcribe(input: TranscribeInput): Promise<string>;
  synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult>;
}

export interface SpeechLogger {
  debug?(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
}
