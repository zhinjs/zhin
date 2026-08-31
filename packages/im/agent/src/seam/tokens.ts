/**
 * 能力接缝 DI Token
 */

import { createToken } from '@zhin.js/plugin-runtime';
import type { SeamIntegration } from './seam-integration.js';

/** @deprecated Legacy non-Runtime DI symbol. Use capabilitySeamToken. */
export const seamIntegrationToken = Symbol.for('@zhin.js/agent:seam-integration');

/** Canonical Plugin Runtime resource token consumed by CapabilityIngress. */
export const capabilitySeamToken = createToken<SeamIntegration>(
  'zhin.agent.capability-seam',
  'Generation-owned Agent Tool and Skill service providers',
);
export type SeamIntegrationToken = typeof seamIntegrationToken;
export type CapabilitySeamToken = typeof capabilitySeamToken;

export type { SeamIntegration };
