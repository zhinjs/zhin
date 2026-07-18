import { defineCommand } from '@zhin.js/command';
import {
  platformIdentity,
  requireOauthModel,
  whoamiOauth,
} from '../../lib/github-oauth.js';
import { resolveGhClient } from '../../lib/github-api.js';
import { getAdapter } from '@zhin.js/adapter-github';

export default defineCommand({
  description: '查看 Bot / App 与当前用户绑定状态',
  execute: async ({ input, use }) => {
    const modelOrError = requireOauthModel(use);
    if (typeof modelOrError === 'string') {
      // DB missing: still report App identity honestly.
      const api = await resolveGhClient(input);
      if (typeof api === 'string') return `${api}\n${modelOrError}`;
      const auth = await api.verifyAuth();
      let extra = '';
      try {
        const installs = getAdapter().getInstallations();
        if (installs.length) {
          extra = `\nInstallations: ${installs.map((i) => i.account.login).join(', ')}`;
        }
      } catch {
        /* registry 未就绪 */
      }
      return auth.ok
        ? `Bot / App: ${auth.user}${extra}\n${modelOrError}`
        : `GitHub 认证失败: ${auth.message}\n${modelOrError}`;
    }
    const identity = platformIdentity(input);
    if (typeof identity === 'string') {
      const api = await resolveGhClient(input);
      if (typeof api === 'string') return api;
      const auth = await api.verifyAuth();
      return auth.ok
        ? `Bot / App: ${auth.user}\n${identity}`
        : `GitHub 认证失败: ${auth.message}`;
    }
    return whoamiOauth(modelOrError, identity.platform, identity.uid);
  },
});
