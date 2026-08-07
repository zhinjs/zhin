import type { ProviderResult, ScanInput } from '../types.js';

export interface ModerationProvider {
  readonly id: string;
  scan(input: ScanInput): Promise<ProviderResult>;
}
