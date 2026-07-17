import {
  normalizeClientModuleArtifact,
  type LayoutSlot,
} from '@zhin.js/next-console-contract';
import type { ValidationContext } from '@zhin.js/feature-kit';

export interface LayoutDefinition {
  readonly slot: LayoutSlot;
  readonly module: string;
  readonly hash: string;
}

export function parseLayoutArtifact(value: unknown, context: ValidationContext): LayoutDefinition {
  if (context.localName !== 'nav' && context.localName !== 'footer') {
    throw new TypeError(`Unsupported Layout slot: ${context.localName}`);
  }
  const artifact = normalizeClientModuleArtifact(value, `Layout ${context.source}`);
  return Object.freeze({
    slot: context.localName,
    module: artifact.module,
    hash: artifact.hash,
  });
}
