import type { Adapter } from '../adapter.js';
import type { InteractivePolicy } from './interactive-segments/types.js';

/** 契约测试：adapter 须声明 interactivePolicy */
export function assertAdapterDeclaresInteractivePolicy(
  adapterClass: { interactivePolicy?: InteractivePolicy },
): void {
  if (!adapterClass.interactivePolicy) {
    throw new Error('Adapter must declare static interactivePolicy');
  }
  if (adapterClass.interactivePolicy !== 'native' && adapterClass.interactivePolicy !== 'text') {
    throw new Error('interactivePolicy must be "native" or "text"');
  }
}

export type { InteractivePolicy };
