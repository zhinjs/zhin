/**
 * GitHub 适配器入口：类型扩展、模型、导出、注册
 */
import { usePlugin, type Plugin, type Context } from 'zhin.js';
import { GitHubAdapter } from './adapter.js';

declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      router: import('@zhin.js/http').Router;
    }
  }
  interface Adapters {
    github: GitHubAdapter;
  }
  interface Models {
    github_subscriptions: {
      id: number;
      repo: string;
      events: import('./types.js').EventType[];
      target_id: string;
      target_type: 'private' | 'group' | 'channel';
      adapter: string;
      bot: string;
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
export { GitHubBot, parseMarkdown, toMarkdown } from './bot.js';
export { GitHubAdapter } from './adapter.js';

const plugin = usePlugin();
const { provide, defineModel, useContext, logger } = plugin;

defineModel('github_subscriptions', {
  id: { type: 'integer', primary: true },
  repo: { type: 'text', nullable: false },
  events: { type: 'json', default: [] },
  target_id: { type: 'text', nullable: false },
  target_type: { type: 'text', nullable: false },
  adapter: { type: 'text', nullable: false },
  bot: { type: 'text', nullable: false },
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
  github_id: { type: 'integer', nullable: false },
  access_token: { type: 'text', nullable: false },
  scope: { type: 'text', default: '' },
  created_at: { type: 'date', nullable: false },
  updated_at: { type: 'date', nullable: false },
});

provide({
  name: 'github',
  description: 'GitHub Adapter — Issues/PRs as chat channels, full repo management via GitHub App',
  mounted: async (p: Plugin) => {
    const adapter = new GitHubAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: GitHubAdapter) => {
    await adapter.stop();
  },
} as Context<'github'>);

useContext('router', 'github', (router, adapter) => {
  adapter.setupWebhook(router);
  adapter.setupOAuth(router);
});

logger.debug('GitHub 适配器已加载 (GitHub App 认证)');
