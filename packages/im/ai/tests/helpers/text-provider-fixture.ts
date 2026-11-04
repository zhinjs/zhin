/** Synthetic callback metadata for consuming-boundary tests, never a production Provider. */
import type { StreamOptions, TextCompleteResult } from '../../src/index.js';
export type FixtureTextOptions = StreamOptions & Readonly<{ model?: string; timeoutMs?: number; resilience?: import('../../src/llm/provider-resilience.js').ProviderResilienceConfig }>;
export interface FixtureTextProvider {
  name: string;
  models: string[];
  completeText(system: string, user: string, options?: FixtureTextOptions): Promise<string>;
  completeTextResult?(system: string, user: string, options?: FixtureTextOptions): Promise<TextCompleteResult>;
}
