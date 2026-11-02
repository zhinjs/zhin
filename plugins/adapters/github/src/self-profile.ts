import { createEndpointOperation, type EndpointProfile } from 'zhin.js/adapter';
import type { GhClient } from './gh-client.js';

interface GithubSelfProfileOptions {
  readonly client: Pick<GhClient, 'getBotIdentity' | 'request'>;
  readonly reportAccount: (id: string) => void;
}

/** PAT accounts read /user; GitHub Apps read the verified app bot's public user profile. */
export function createGithubSelfProfile({ client, reportAccount }: GithubSelfProfileOptions): EndpointProfile {
  return Object.freeze<EndpointProfile>({
    writableFields: Object.freeze([]),
    async read({ signal }) {
      const operation = createEndpointOperation({ signal });
      const bot = await operation.prepare(() => client.getBotIdentity());
      const response = await client.request<{ id?: number; login?: string; name?: string | null; bio?: string | null; avatar_url?: string }>({
        method: 'GET', path: bot ? `/users/${encodeURIComponent(bot.login)}` : '/user', signal,
      });
      if (!response.ok || !response.data?.id || typeof response.data.login !== 'string') throw new Error('GitHub returned no account profile');
      if (bot && response.data.id !== bot.userId) throw new Error('GitHub returned another account profile');
      const user = response.data;
      reportAccount(String(user.id));
      return { nickname: user.name || user.login,
        ...(user.bio === null || typeof user.bio === 'string' ? { bio: user.bio } : {}),
        ...(typeof user.avatar_url === 'string' ? { avatar: user.avatar_url } : {}) };
    },
  });
}
