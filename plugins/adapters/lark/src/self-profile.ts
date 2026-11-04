import { createEndpointOperation, type EndpointProfile } from 'zhin.js/adapter';
import type { LarkClient } from './client.js';

interface LarkSelfProfileOptions {
  readonly client: Pick<LarkClient, 'request' | 'config'>;
  readonly reportAccount: (id: string) => void;
}

/** Same bot-info endpoint used for read-only credential identity verification. */
export function createLarkSelfProfile({ client, reportAccount }: LarkSelfProfileOptions): EndpointProfile {
  return Object.freeze<EndpointProfile>({
    writableFields: Object.freeze([]),
    async read({ signal }) {
      const response = await createEndpointOperation({ signal }).prepare(() => client.request<{
        code?: number; bot?: { open_id?: string; app_name?: string; avatar_url?: string };
      }>({ url: `${client.config.apiBaseUrl}/bot/v3/info`, method: 'GET' }));
      if (response.code !== 0 || !response.bot?.open_id) throw new Error('Lark returned no bot profile');
      reportAccount(response.bot.open_id);
      return { ...(typeof response.bot.app_name === 'string' ? { nickname: response.bot.app_name } : {}),
        ...(typeof response.bot.avatar_url === 'string' ? { avatar: response.bot.avatar_url } : {}) };
    },
  });
}
