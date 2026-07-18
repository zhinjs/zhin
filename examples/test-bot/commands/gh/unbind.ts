import { defineCommand } from '@zhin.js/command';
import {
  platformIdentity,
  requireOauthModel,
  unbindOauth,
} from '../../lib/github-oauth.js';

export default defineCommand({
  description: '解绑 GitHub 账号',
  execute: async ({ input, use }) => {
    const modelOrError = requireOauthModel(use);
    if (typeof modelOrError === 'string') return modelOrError;
    const identity = platformIdentity(input);
    if (typeof identity === 'string') return identity;
    return unbindOauth(modelOrError, identity.platform, identity.uid);
  },
});
