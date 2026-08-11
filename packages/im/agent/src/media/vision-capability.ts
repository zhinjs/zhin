import type { AIProvider } from '@zhin.js/ai';

export function providerSupportsVision(provider: AIProvider): boolean {
  return provider.capabilities?.vision === true;
}
