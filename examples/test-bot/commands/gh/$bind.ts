import { defineCommand } from 'zhin.js/command';
import {
  bindWithPat,
  platformIdentity,
  requireOauthModel,
  startDeviceFlowBind,
} from '../../lib/github-oauth.js';
import { resolveGithubEndpoint } from '../../lib/github-api.js';

/**
 * Bind the chat user to a GitHub identity (PAT or Device Flow).
 * Persists into DatabaseHost `github_oauth_users` — never logs the token.
 */
export default defineCommand({
  description: '绑定 GitHub 账号（PAT 或 Device Flow）',
  execute: async (context) => {
    const { args, input } = context;
    const endpoint = resolveGithubEndpoint(context);
    if (typeof endpoint === 'string') return endpoint;
    const modelOrError = requireOauthModel(endpoint);
    if (typeof modelOrError === 'string') return modelOrError;
    const identity = platformIdentity(input);
    if (typeof identity === 'string') return identity;

    const token = args.join(' ').trim();
    if (token) {
      return bindWithPat(endpoint, modelOrError, identity.platform, identity.uid, token);
    }
    return startDeviceFlowBind(endpoint, modelOrError, identity.platform, identity.uid);
  },
});
