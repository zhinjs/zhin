import { readFile } from 'node:fs/promises';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { seedSpeechPipeline } from '@zhin.js/core';
import {
  expandEnvironmentValue,
  type ConfigDocumentPort,
  type RootResourceInstaller,
  type RuntimeConfigDocument,
} from '@zhin.js/runtime';

export interface SpeechHostConfig {
  readonly stt?: Record<string, unknown>;
  readonly tts?: Record<string, unknown>;
}

export interface SpeechHostTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
  execute(args: Record<string, unknown>): Promise<unknown>;
  readonly source?: string;
}

export interface SpeechHostHandle {
  readonly tools: readonly SpeechHostTool[];
  readonly sttProvider: string;
  readonly ttsProvider: string;
  /** Inbound preprocess: download URL and transcribe. */
  transcribeUrl(audioUrl: string): Promise<string | null>;
}

interface SpeechPipelineLike {
  transcribe(input: { data: Buffer; mimeType?: string }): Promise<string>;
  synthesize(input: {
    text: string;
    voice?: string;
    provider?: string;
  }): Promise<{ data: Buffer; format: string }>;
}

const logger = getLogger('Speech');

export async function resolveSpeechConfig(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<SpeechHostConfig | undefined> {
  const document = await readConfigDocument(config);
  if (!document || typeof document !== 'object') return undefined;
  const speech = (document as Record<string, unknown>).speech;
  if (!speech || typeof speech !== 'object') return undefined;
  return expandEnvironmentValue(speech, (key) => process.env[key]) as SpeechHostConfig;
}

/**
 * Optional Speech Host:
 * - top-level `speech:` → createSpeechPipeline + seedSpeechPipeline (TTS rich segment)
 * - exposes voice_stt / voice_tts tools for Agent Host
 */
export async function prepareSpeechHost(
  config: SpeechHostConfig | undefined,
): Promise<SpeechHostHandle | undefined> {
  if (!config) return undefined;
  try {
    const mod = await import('@zhin.js/speech') as {
      createSpeechPipeline: (
        config?: SpeechHostConfig,
        logger?: { debug?(m: string): void; warn?(m: string): void },
      ) => SpeechPipelineLike;
    };
    const pipeline = mod.createSpeechPipeline(config, logger);
    seedSpeechPipeline(pipeline as never);
    const tools = buildSpeechTools(pipeline);
    const sttProvider = typeof config.stt?.provider === 'string' ? config.stt.provider : 'ollama';
    const ttsProvider = typeof config.tts?.provider === 'string' ? config.tts.provider : 'edge';
    return Object.freeze({
      tools,
      sttProvider,
      ttsProvider,
      async transcribeUrl(audioUrl: string): Promise<string | null> {
        const url = audioUrl.trim();
        if (!url) return null;
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`download failed: ${response.status}`);
          const buffer = Buffer.from(await response.arrayBuffer());
          const mimeType = response.headers.get('content-type') || 'audio/wav';
          const text = await pipeline.transcribe({ data: buffer, mimeType });
          const trimmed = text.trim();
          return trimmed || null;
        } catch (error) {
          logger.warn(formatCompact({
            op: 'speech_host_stt_fail',
            error: error instanceof Error ? error.message : String(error),
          }));
          return null;
        }
      },
    });
  } catch (error) {
    logger.warn(formatCompact({
      op: 'speech_host_skip',
      reason: 'speech_package_unavailable',
      error: error instanceof Error ? error.message : String(error),
    }));
    return undefined;
  }
}

export function installSpeechHost(handle: SpeechHostHandle | undefined): RootResourceInstaller {
  return ({ lifecycle }) => {
    if (!handle) return;
    lifecycle.add(() => {
      /* pipeline cache lives for process; restart clears via process exit */
    });
    logger.info(formatCompact({
      op: 'speech_host_ready',
      stt: handle.sttProvider,
      tts: handle.ttsProvider,
      tools: handle.tools.map((tool) => tool.name).join(','),
    }));
  };
}

function buildSpeechTools(pipeline: SpeechPipelineLike): SpeechHostTool[] {
  return [
    {
      name: 'voice_stt',
      description: '将语音/音频消息转写为文字',
      source: 'speech',
      parameters: {
        type: 'object',
        properties: {
          audio_url: { type: 'string', description: '音频文件 URL' },
          file_path: { type: 'string', description: '本地音频绝对路径' },
        },
      },
      async execute(args) {
        const audioUrl = typeof args.audio_url === 'string' ? args.audio_url : '';
        const filePath = typeof args.file_path === 'string' ? args.file_path : '';
        if (!audioUrl && !filePath) return { error: '需要提供 audio_url 或 file_path' };
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
        } catch (error) {
          return { error: `语音识别失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },
    {
      name: 'voice_tts',
      description: '将文字转换为语音（返回 base64 音频）',
      source: 'speech',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要转换为语音的文字' },
          voice: { type: 'string', description: '语音类型（覆盖默认）' },
          provider: {
            type: 'string',
            description: 'TTS provider：edge | openai | azure | custom',
            enum: ['edge', 'openai', 'azure', 'custom'],
          },
        },
        required: ['text'],
      },
      async execute(args) {
        const text = typeof args.text === 'string' ? args.text : '';
        if (!text) return { error: '需要提供 text' };
        try {
          const result = await pipeline.synthesize({
            text,
            voice: typeof args.voice === 'string' ? args.voice : undefined,
            provider: typeof args.provider === 'string' ? args.provider : undefined,
          });
          return {
            audio: result.data.toString('base64'),
            format: result.format,
            size: result.data.length,
            message: `语音合成完成 (${(result.data.length / 1024).toFixed(1)} KB)`,
          };
        } catch (error) {
          return { error: `语音合成失败: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },
  ];
}

async function readConfigDocument(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<unknown> {
  if (!isConfigDocumentPort(config)) return config;
  return (await config.read()).document;
}

function isConfigDocumentPort(value: unknown): value is ConfigDocumentPort {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ConfigDocumentPort>;
  return typeof candidate.read === 'function';
}
