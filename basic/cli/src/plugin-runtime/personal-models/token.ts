import { createRootPrivateToken } from '@zhin.js/plugin-runtime';
import type { PersonalModelManagementService } from './service.js';

export const personalModelManagementToken = createRootPrivateToken<PersonalModelManagementService>(
  'zhin.host.personal-model-management',
  'Authenticated personal model metadata and credential management',
);
