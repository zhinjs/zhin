import { segment } from '../../utils.js';
import { RichSegment } from './base.js';
import type {
  RichSegmentRenderContext,
  RichSegmentRenderResult,
  SpeechPipelineForRichSegment,
} from './types.js';
import { RICH_SEGMENT_MODE } from './types.js';

export interface TtsSegmentData {
  text: string;
  voice?: string;
  provider?: string;
}

async function resolveSpeechPipeline(
  ctx?: RichSegmentRenderContext,
): Promise<SpeechPipelineForRichSegment | undefined> {
  if (!ctx?.resolveCapability) return undefined;
  return ctx.resolveCapability<SpeechPipelineForRichSegment>('speech');
}

export class TtsSegment extends RichSegment<TtsSegmentData> {
  readonly segmentType = 'tts' as const;
  readonly type = 'tts' as const;

  async render(mode: string, ctx?: RichSegmentRenderContext): Promise<RichSegmentRenderResult> {
    if (mode === RICH_SEGMENT_MODE.ORIGIN) {
      return this.toJSON();
    }

    const text = typeof this.data.text === 'string' ? this.data.text : '';

    if (mode === RICH_SEGMENT_MODE.TEXT) {
      return segment.text(text);
    }

    if (mode === RICH_SEGMENT_MODE.AUDIO) {
      if (!text.trim()) {
        return segment.text('');
      }

      const pipeline = await resolveSpeechPipeline(ctx);
      if (!pipeline) {
        return this.render(RICH_SEGMENT_MODE.TEXT, ctx);
      }

      try {
        const result = await pipeline.synthesize({
          text,
          voice: typeof this.data.voice === 'string' ? this.data.voice : undefined,
          provider: typeof this.data.provider === 'string' ? this.data.provider : undefined,
        });
        const base64 = result.data.toString('base64');
        const mime = result.format === 'wav' ? 'audio/wav' : 'audio/mpeg';
        return segment('audio', { url: `data:${mime};base64,${base64}`, format: result.format });
      } catch {
        return this.render(RICH_SEGMENT_MODE.TEXT, ctx);
      }
    }

    return this.render(RICH_SEGMENT_MODE.TEXT, ctx);
  }
}

export function wrapTtsSegment(data: Record<string, unknown>): TtsSegment {
  return new TtsSegment({
    text: String(data.text ?? ''),
    voice: typeof data.voice === 'string' ? data.voice : undefined,
    provider: typeof data.provider === 'string' ? data.provider : undefined,
  });
}
