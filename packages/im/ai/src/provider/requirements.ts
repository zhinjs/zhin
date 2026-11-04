import { isMediaContentBlock } from '../llm/types/content-block.js';
import { ProviderError, type ExecutionBinding, type LanguageRequest, type ModelDefinition } from './types.js';

/** Concrete request needs. Unknown model capabilities never satisfy an explicit requirement. */
export interface ProviderModelRequirements {
  readonly input?: readonly NonNullable<ModelDefinition['input']>[number][];
  readonly streaming?: boolean;
  readonly toolCalling?: boolean;
  readonly thinking?: boolean;
}
export function providerModelSupports(input: Readonly<{ model: ModelDefinition; requirements: ProviderModelRequirements }>): boolean {
  const { model, requirements } = input;
  return (requirements.input ?? []).every(kind => (model.input ?? ['text']).includes(kind))
    && (['streaming', 'toolCalling', 'thinking'] as const).every(kind => requirements[kind] !== true || model[kind] === true);
}
/** One final request boundary for tools, reasoning and all native media, before credentials or HTTP. */
export function assertProviderLanguageRequirements(input: Readonly<{
  binding: ExecutionBinding;
  request: LanguageRequest;
  streaming?: boolean;
}>): void {
  const modalities = new Set<NonNullable<ModelDefinition['input']>[number]>(['text']);
  for (const message of input.request.context.messages) {
    if (message.role === 'user' && Array.isArray(message.media)) for (const media of message.media) {
      if (isMediaContentBlock(media)) modalities.add(media.type);
    }
    if (message.role === 'toolResult' && Array.isArray(message.content)) for (const content of message.content) {
      if (isMediaContentBlock(content)) modalities.add(content.type);
    }
  }
  const thinking = input.request.options?.thinkingLevel ?? input.binding.profile.parameters.thinkingLevel;
  if (!providerModelSupports({ model: input.binding.model, requirements: {
    input: [...modalities], streaming: input.streaming,
    toolCalling: !!input.request.context.tools?.length,
    thinking: thinking === 'low' || thinking === 'medium' || thinking === 'high',
  } })) throw new ProviderError('unsupported-capability');
}
