import type { EndpointProfile } from 'zhin.js/adapter';
import type { SelfProfile } from '@zhin.js/im-contract';
import type { TelegramClientApi } from './telegram-client.js';

interface TelegramSelfProfileOptions {
  readonly client: Pick<TelegramClientApi, 'callApi' | 'callApiForm'>;
  readonly current: () => Readonly<SelfProfile>;
  readonly nicknameChanged: (nickname: string) => void;
}

/** Bot API names/descriptions are account fields, not the title/description of a chat. */
export function createTelegramSelfProfile({ client, current, nicknameChanged }: TelegramSelfProfileOptions): EndpointProfile {
  return Object.freeze<EndpointProfile>({
    writableFields: Object.freeze(['nickname', 'signature', 'bio', 'avatar']),
    get current() { return current(); },
    async read({ signal }) {
      const [name, description, shortDescription] = await Promise.all([
        client.callApi<{ name: string }>('getMyName', {}, signal),
        client.callApi<{ description: string }>('getMyDescription', {}, signal),
        client.callApi<{ short_description: string }>('getMyShortDescription', {}, signal),
      ]);
      if (typeof name.name !== 'string' || typeof description.description !== 'string' || typeof shortDescription.short_description !== 'string') {
        throw new Error('Telegram returned an incomplete bot profile');
      }
      return { nickname: name.name, signature: shortDescription.short_description, bio: description.description };
    },
    async write({ change, signal }) {
      if (change.field === 'avatar') {
        if (change.value.kind !== 'base64' || change.value.mime_type !== 'image/jpeg') {
          return { status: 'rejected', message: 'Telegram profile photos require resolved JPEG image bytes' };
        }
        const form = new FormData();
        form.set('photo', JSON.stringify({ type: 'static', photo: 'attach://avatar' }));
        form.set('avatar', new Blob([Uint8Array.from(Buffer.from(change.value.value, 'base64'))], { type: 'image/jpeg' }), 'avatar.jpg');
        const accepted = await client.callApiForm<boolean>('setMyProfilePhoto', form, signal);
        return accepted === true ? { status: 'updated' } : { status: 'rejected', message: 'Telegram rejected the avatar change' };
      }
      let method: string;
      let params: Record<string, unknown>;
      switch (change.field) {
        case 'nickname': method = 'setMyName'; params = { name: change.value }; break;
        case 'signature': method = 'setMyShortDescription'; params = { short_description: change.value }; break;
        case 'bio': method = 'setMyDescription'; params = { description: change.value }; break;
        default: return { status: 'rejected', message: `Telegram bot profile does not expose ${change.field} through this port` };
      }
      const accepted = await client.callApi<boolean>(method, params, signal);
      if (accepted !== true) return { status: 'rejected', message: `Telegram rejected the ${change.field} change` };
      if (change.field === 'nickname') nicknameChanged(change.value);
      return { status: 'updated', profile: { [change.field]: change.value } };
    },
  });
}
