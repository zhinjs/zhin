/**
 * GitHub 适配器入口：类型扩展、模型、导出、注册
 */
import { formatCompact, type Context, type Plugin, usePlugin } from 'zhin.js';
import { registerAgentPromptContributor, unregisterAgentPromptContributor } from 'zhin.js/agent';
import { createGithubAgentPromptContributor } from './agent-prompt.js';
import { GitHubAdapter } from './adapter.js';
import { registerGithubMcp } from './register-github-mcp.js';
import { setGithubAgentDeps } from './github-agent-deps.js';

declare module 'zhin.js' {
  interface Adapters {
    github: GitHubAdapter;
  }
  namespace Plugin {
    interface Contexts {
      router: import('@zhin.js/host-router').Router;
    }
  }
  interface Models {
    github_subscriptions: {
      id: number;
      repo: string;
      events: import('./types.js').EventType[];
      target_id: string;
      target_type: 'private' | 'group' | 'channel';
      adapter: string;
      endpoint: string;
    };
    github_events: {
      id: number;
      repo: string;
      event_type: string;
      payload: any;
    };
    github_oauth_users: import('./types.js').GitHubOAuthUser;
  }
}

export * from './types.js';
export { GitHubEndpoint, parseMarkdown, toMarkdown } from './endpoint.js';
export { GitHubAdapter } from './adapter.js';
export { GhClient } from './gh-client.js';

const plugin = usePlugin();
const { provide, defineModel, useContext, logger } = plugin;

registerGithubMcp(plugin);

defineModel('github_subscriptions', {
  id: { type: 'integer', primary: true },
  repo: { type: 'text', nullable: false },
  events: { type: 'json', default: [] },
  target_id: { type: 'text', nullable: false },
  target_type: { type: 'text', nullable: false },
  adapter: { type: 'text', nullable: false },
  endpoint: { type: 'text', nullable: false },
});

defineModel('github_events', {
  id: { type: 'integer', primary: true },
  repo: { type: 'text', nullable: false },
  event_type: { type: 'text', nullable: false },
  payload: { type: 'json', default: {} },
});

defineModel('github_oauth_users', {
  id: { type: 'integer', primary: true },
  platform: { type: 'text', nullable: false },
  platform_uid: { type: 'text', nullable: false },
  github_login: { type: 'text', nullable: false },
  access_token: { type: 'text', nullable: false },
  created_at: { type: 'integer', default: 0 },
});

provide({
  name: 'github',
  description: 'GitHub Adapter — Issues/PRs as chat channels, full repo management via gh CLI',
  mounted: async (p: Plugin) => {
    registerAgentPromptContributor(createGithubAgentPromptContributor());
    const adapter = new GitHubAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: GitHubAdapter) => {
    unregisterAgentPromptContributor('github');
    await adapter.stop();
  },
} as Context<'github'>);

// 混合模式：有 router + webhook_secret → Webhook 实时；否则 → 轮询降级
useContext('github', (adapter) => {
  if (adapter.hasWebhookConfig) {
    const router = plugin.inject('router');
    if (router) {
      adapter.setupWebhook(router);
      logger.debug(formatCompact({ op: 'events', source: 'webhook' }));
    } else {
      plugin.useContext('router', (r) => {
        adapter.setupWebhook(r);
        logger.debug(formatCompact({ op: 'events', source: 'webhook', deferred: true }));
      });
    }
  }
  if (!adapter.webhookActive) {
    adapter.startPolling();
    logger.debug(formatCompact({ op: 'events', source: 'poll' }));
  }
  return () => adapter.stopPolling();
});

useContext('tool', 'github', (_toolService, adapter: GitHubAdapter) => {
  setGithubAgentDeps({
    getAdapter: () => adapter,
    plugin,
  });
  logger.debug('GitHub agent deps initialized');
  return () => {};
});

logger.debug('GitHub 适配器已加载 (gh CLI 认证)');
