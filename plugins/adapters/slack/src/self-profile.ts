import { createEndpointOperation, type EndpointProfile } from 'zhin.js/adapter';
import type { WebClient } from '@slack/web-api';

interface SlackSelfProfileOptions {
  readonly client: Pick<WebClient, 'users'>;
  readonly accountId: () => string | undefined;
}

/** Bot-token reads use users.info. User-token-only profile mutations are not advertised. */
export function createSlackSelfProfile({ client, accountId }: SlackSelfProfileOptions): EndpointProfile {
  return Object.freeze<EndpointProfile>({
    writableFields: Object.freeze([]),
    async read({ signal }) {
      const id = accountId();
      if (!id) throw new Error('Slack self account is unavailable');
      const response = await createEndpointOperation({ signal }).prepare(() => client.users.info({ user: id }));
      if (!response.ok || response.user?.id !== id) throw new Error('Slack returned no matching self profile');
      const profile = response.user.profile;
      const nickname = profile?.display_name || profile?.real_name || response.user.real_name || response.user.name;
      return { ...(typeof nickname === 'string' ? { nickname } : {}),
        ...(typeof profile?.image_512 === 'string' ? { avatar: profile.image_512 } : {}) };
    },
  });
}
