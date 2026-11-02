import { createEndpointOperation, type EndpointProfile } from 'zhin.js/adapter';
import type { Bot } from 'qq-official-bot';

interface QqSelfProfileOptions {
  readonly client: Pick<Bot, 'getSelfInfo'>;
  readonly reportAccount: (id: string) => void;
}

/** QQ official Bot.Info has an actual bot id, display username and public avatar URL. */
export function createQqSelfProfile({ client, reportAccount }: QqSelfProfileOptions): EndpointProfile {
  return Object.freeze<EndpointProfile>({
    writableFields: Object.freeze([]),
    async read({ signal }) {
      const self = await createEndpointOperation({ signal }).prepare(() => client.getSelfInfo());
      if (!self?.id || typeof self.username !== 'string') throw new Error('QQ returned an incomplete bot profile');
      reportAccount(self.id);
      return { nickname: self.username, ...(typeof self.avatar === 'string' ? { avatar: self.avatar } : {}) };
    },
  });
}
