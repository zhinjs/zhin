import { definePlugin, databaseHostToken } from '@zhin.js/plugin-runtime';
import { defineGithubOauthUsersTable } from './src/oauth-users.js';

/**
 * github_subscriptions — repo event subscriptions per chat channel
 * (used by github_subscriptions agent tool; schema matches legacy defineModel).
 */
const GITHUB_SUBSCRIPTIONS_SCHEMA = {
  id: { type: 'integer', primary: true },
  repo: { type: 'text', nullable: false },
  events: { type: 'json', default: [] },
  target_id: { type: 'text', nullable: false },
  target_type: { type: 'text', nullable: false },
  adapter: { type: 'text', nullable: false },
  endpoint: { type: 'text', nullable: false },
} as const;

/**
 * Plugin Runtime GitHub adapter.
 * - Endpoint: `adapters/github.ts`
 * - OAuth user tokens: define `github_oauth_users` when DatabaseHost is present
 */
export default definePlugin({
  name: 'github',
  metadata: {
    displayName: 'GitHub Adapter',
  },
  setup(context) {
    if (context.resources.has(databaseHostToken)) {
      const host = context.resources.use(databaseHostToken);
      defineGithubOauthUsersTable(host);
      host.define('github_subscriptions', { ...GITHUB_SUBSCRIPTIONS_SCHEMA });
    }

    // Agent prompt contributor (orchestrator/deferred-worker GitHub guidance).
    // `zhin.js/agent` is an optional peer — skip silently on IM-only installs.
    let cancelled = false;
    let unregister: (() => void) | undefined;
    void Promise.all([
      import('zhin.js/agent'),
      import('./src/agent-prompt.js'),
    ]).then(([agent, prompt]) => {
      if (cancelled) return;
      agent.registerAgentPromptContributor(prompt.createGithubAgentPromptContributor());
      unregister = () => agent.unregisterAgentPromptContributor('github');
    }).catch(() => { /* optional peer not installed */ });
    return () => {
      cancelled = true;
      unregister?.();
    };
  },
});
