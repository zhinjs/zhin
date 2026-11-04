import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/** One stable Host namespace for configuration validation and execution ownership. */
export function hostModelOwnerId(projectRoot: string): string {
  return `host-owner:v1:${createHash('sha256').update(resolve(projectRoot)).digest('hex')}`;
}
