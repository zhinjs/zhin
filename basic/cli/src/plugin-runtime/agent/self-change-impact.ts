import type { SelfChangeImpactPort } from '@zhin.js/agent';
import { HOST_CONFIG_KEYS, InvalidationPlanner, type SourceOwnershipIndex } from '@zhin.js/runtime';

/**
 * ADR 0040 §2: `change_draft` previews use the same `InvalidationPlanner` as development file
 * watching, over the committed generation's source ownership; config sections follow Console
 * `config:patch` (`HOST_CONFIG_KEYS` need a restart). Absent ownership → the preview estimates.
 */
export function createSelfChangeImpactPort(
  sourceOwnership: (() => SourceOwnershipIndex) | undefined,
): SelfChangeImpactPort | undefined {
  if (!sourceOwnership) return undefined;
  return Object.freeze({
    hostConfigKeys: HOST_CONFIG_KEYS,
    planFiles: (absolutePaths: readonly string[]) => new InvalidationPlanner(sourceOwnership()).plan(absolutePaths),
  });
}
