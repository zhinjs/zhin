import { loadHtmlRenderer } from '../html-renderer-loader.js';
import { loadSpeechPipeline } from '../speech-loader.js';
import type {
  HtmlRendererForRichSegment,
  RichSegmentCapabilityLoader,
  RichSegmentCapabilityLoaderOptions,
  RichSegmentRenderContext,
  SpeechPipelineForRichSegment,
} from './types.js';

const capabilityLoaders: Readonly<Record<string, RichSegmentCapabilityLoader>> = Object.freeze({
  'html-renderer': async (options) =>
    loadHtmlRenderer({
      getConfig: options.getConfig,
      warn: options.warn,
    }) as Promise<HtmlRendererForRichSegment | undefined>,
  speech: async (options) =>
    loadSpeechPipeline({
      getConfig: options.getConfig,
      warn: options.warn,
    }) as Promise<SpeechPipelineForRichSegment | undefined>,
});

export function createRichSegmentRenderContext(
  options: RichSegmentCapabilityLoaderOptions = {},
): RichSegmentRenderContext {
  const cache = new Map<string, Promise<unknown>>();

  const resolveCapability = async <T>(id: string): Promise<T | undefined> => {
    if (!cache.has(id)) {
      const loader = capabilityLoaders[id];
      cache.set(id, loader ? loader(options) : Promise.resolve(undefined));
    }
    return cache.get(id) as Promise<T | undefined>;
  };

  return {
    resolveCapability,
    warn: options.warn,
    logContentChain: options.logContentChain,
  };
}
