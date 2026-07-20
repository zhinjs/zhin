import { defineCommand } from '@zhin.js/command';
import {
  bindWithPat,
  platformIdentity,
  requireOauthModel,
  startDeviceFlowBind,
} from '../../lib/github-oauth.js';

/**
 * Bind the chat user to a GitHub identity (PAT or Device Flow).
 * Persists into DatabaseHost `github_oauth_users` — never logs the token.
 */
export default defineCommand({
  description: '绑定 GitHub 账号（PAT 或 Device Flow）',
  execute: async ({ args, input, use }) => {
    const modelOrError = requireOauthModel(use);
    if (typeof modelOrError === 'string') return modelOrError;
    const identity = platformIdentity(input);
    if (typeof identity === 'string') return identity;

    const token = args.join(' ').trim();
    if (token) {
      return bindWithPat(modelOrError, identity.platform, identity.uid, token);
    }
    return startDeviceFlowBind(modelOrError, identity.platform, identity.uid);
  },
});
