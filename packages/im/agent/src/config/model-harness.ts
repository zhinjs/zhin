import type { ProviderDriverReference } from '@zhin.js/ai/provider';
export type { ModelHarnessConfig, ModelHarnessOverride as ModelHarnessConfigItem } from '@zhin.js/ai';
import type { ModelHarnessOverride } from '@zhin.js/ai';

export interface ModelHarnessRow extends ModelHarnessOverride {
  driver: ProviderDriverReference;
  modelPattern: RegExp;
}

export type ResolvedModelHarness = ModelHarnessOverride;
