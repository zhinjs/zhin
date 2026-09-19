import { defineCommand } from 'zhin.js/command';
import {
  platformIdentity,
  requireOauthModel,
  unbindOauth,
} from '../../lib/github-oauth.js';
import { resolveGithubEndpoint } from '../../lib/github-api.js';

export default defineCommand({
  description: '解绑 GitHub 账号',
  execute: async (context) => {
    const { input } = context;
    const endpoint = resolveGithubEndpoint(context);
    if (typeof endpoint === 'string') return endpoint;
    const modelOrError = requireOauthModel(endpoint);
    if (typeof modelOrError === 'string') return modelOrError;
    const identity = platformIdentity(input);
    if (typeof identity === 'string') return identity;
    return unbindOauth(modelOrError, identity.platform, identity.uid);
  },
});
