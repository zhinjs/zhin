import {
  normalizeClientModuleArtifact,
  normalizePageMetadata,
  type NormalizedPageMetadata,
} from '@zhin.js/next-console-contract';
import type { ValidationContext } from '@zhin.js/feature-kit';

export interface PageDefinition extends NormalizedPageMetadata {
  readonly module: string;
  readonly hash: string;
}

export function parsePageArtifact(value: unknown, context: ValidationContext): PageDefinition {
  const artifact = normalizeClientModuleArtifact(value, `Page ${context.source}`);
  return Object.freeze({
    ...normalizePageMetadata(context.localName, artifact.metadata),
    module: artifact.module,
    hash: artifact.hash,
  });
}
