import { ModelRuntimeService } from './service.js';
import type { ModelRuntimeConfig } from './types.js';

/** Static configuration validation: no leases, secrets, personal repository or provider I/O. */
export function validateModelRuntimeConfig(input: unknown, hostOwnerId: string): string[] {
  try {
    new ModelRuntimeService({ config: input as ModelRuntimeConfig, hostOwnerId });
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : 'Invalid AI model configuration'];
  }
}
