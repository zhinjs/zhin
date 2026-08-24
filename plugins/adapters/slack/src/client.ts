import { defineEndpointClient } from 'zhin.js/adapter';
import type { SlackWebClientLike } from './endpoint.js';
import type { SlackEvent } from './protocol.js';

/** Slack users.info response fields projected by the bundled tools. */
export interface SlackUserInfo {
  id?: string;
  name?: string;
  real_name?: string;
  is_admin?: boolean;
  is_bot?: boolean;
  profile?: {
    display_name?: string;
    email?: string;
    status_text?: string;
  };
}

export type SlackClientEventMap = Record<string, SlackEvent>;

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly slack: {
      readonly client: SlackWebClientLike;
      readonly events: SlackClientEventMap;
    };
  }
}

export const slackClient = defineEndpointClient<SlackWebClientLike, SlackClientEventMap>('slack');
