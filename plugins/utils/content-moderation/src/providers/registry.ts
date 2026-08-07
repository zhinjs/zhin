import type { ModerationConfig, SourceConfig } from '../types.js';
import { HttpModerationProvider } from './http.js';
import { LocalLexiconProvider } from './local-lexicon.js';
import type { ModerationProvider } from './types.js';

export interface CreateProvidersOptions {
  readonly cwd?: string;
  readonly fetch?: typeof fetch;
}

export function createProviders(
  config: ModerationConfig,
  options: CreateProvidersOptions = {},
): readonly ModerationProvider[] {
  const cwd = options.cwd ?? process.cwd();
  const providers: ModerationProvider[] = [];
  for (const source of config.sources) {
    if (!source.enabled) continue;
    const provider = createProvider(source, cwd, options.fetch);
    if (provider) providers.push(provider);
  }
  return Object.freeze(providers);
}

function createProvider(
  source: SourceConfig,
  cwd: string,
  fetchImpl?: typeof fetch,
): ModerationProvider | null {
  if (source.type === 'local') {
    return new LocalLexiconProvider(source, cwd);
  }
  if (source.type === 'http') {
    return new HttpModerationProvider(source, { fetch: fetchImpl });
  }
  return null;
}
