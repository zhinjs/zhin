/**
 * 能力接缝 DI Token
 */

import { createToken } from '@zhin.js/plugin-runtime';
import type { SeamIntegration } from './seam-integration.js';

export const seamIntegrationToken = createToken<SeamIntegration>(
  'zhin.agent.capability-seam',
  'Generation-owned Agent Tool and Skill service providers',
);
export type SeamIntegrationToken = typeof seamIntegrationToken;

export type { SeamIntegration };
