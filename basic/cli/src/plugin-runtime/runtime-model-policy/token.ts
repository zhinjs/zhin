import { createRootPrivateToken } from '@zhin.js/plugin-runtime';
import type { RuntimePolicyManagementService } from './service.js';
export const runtimePolicyManagementToken = createRootPrivateToken<RuntimePolicyManagementService>(
  'zhin.host.runtime-model-policy', 'Full operator deployment model reference overrides',
);
