import { loadHtmlRenderer } from '../html-renderer-loader.js';
import { loadSpeechPipeline } from '../speech-loader.js';
import type {
  HtmlRendererForRichSegment,
  RichSegmentCapabilityLoader,
  RichSegmentCapabilityLoaderOptions,
  RichSegmentRenderContext,
  SpeechPipelineForRichSegment,
} from './types.js';

const capabilityLoaders = new Map<string, RichSegmentCapabilityLoader>();

/** 注册 optional 包能力（如 html-renderer、未来 media-pipeline） */
export function registerRichSegmentCapabilityLoader(
  id: string,
  loader: RichSegmentCapabilityLoader,
): void {
  capabilityLoaders.set(id, loader);
}

/** 测试隔离 */
export function resetRichSegmentCapabilityLoadersForTests(): void {
  capabilityLoaders.clear();
  registerCoreRichSegmentCapabilityLoaders();
}

function registerCoreRichSegmentCapabilityLoaders(): void {
  registerRichSegmentCapabilityLoader('html-renderer', async (options) =>
    loadHtmlRenderer({
      getConfig: options.getConfig,
      warn: options.warn,
    }) as Promise<HtmlRendererForRichSegment | undefined>,
  );
  registerRichSegmentCapabilityLoader('speech', async (options) =>
    loadSpeechPipeline({
      getConfig: options.getConfig,
      warn: options.warn,
    }) as Promise<SpeechPipelineForRichSegment | undefined>,
  );
}

registerCoreRichSegmentCapabilityLoaders();

export function createRichSegmentRenderContext(
  options: RichSegmentCapabilityLoaderOptions = {},
): RichSegmentRenderContext {
  const cache = new Map<string, Promise<unknown>>();

  const resolveCapability = async <T>(id: string): Promise<T | undefined> => {
    if (!cache.has(id)) {
      const loader = capabilityLoaders.get(id);
      cache.set(id, loader ? loader(options) : Promise.resolve(undefined));
    }
    return cache.get(id) as Promise<T | undefined>;
  };

  return {
    resolveCapability,
    getHtmlRenderer: () => resolveCapability<HtmlRendererForRichSegment>('html-renderer'),
    warn: options.warn,
    logContentChain: options.logContentChain,
  };
}
