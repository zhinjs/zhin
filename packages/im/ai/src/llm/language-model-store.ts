/**
 * Internal LanguageModel registry keyed by provider alias + model id.
 */

import type { LanguageModel } from 'ai';

const languageModels = new Map<string, LanguageModel>();

function storeKey(alias: string, modelId: string): string {
  return `${alias}::${modelId}`;
}

export function registerLanguageModel(
  alias: string,
  modelId: string,
  model: LanguageModel,
): void {
  languageModels.set(storeKey(alias, modelId), model);
}

export function getLanguageModel(alias: string, modelId: string): LanguageModel | undefined {
  return languageModels.get(storeKey(alias, modelId));
}

export function clearLanguageModelStoreForTests(): void {
  languageModels.clear();
}
