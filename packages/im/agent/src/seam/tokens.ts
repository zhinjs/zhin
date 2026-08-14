/**
 * 能力接缝 DI Token
 */

import type { SeamIntegration } from './seam-integration.js';

export const seamIntegrationToken = Symbol.for('@zhin.js/agent:seam-integration');
export type SeamIntegrationToken = typeof seamIntegrationToken;

export type { SeamIntegration };
