/** Convention discovery entry; public classes and types live in src/. */
import { defineAdapter } from 'zhin.js/adapter';
import { IpadWechatAdapter } from '../../src/adapter.js';
import type { IpadWechatEndpointConfig } from '../../src/protocol.js';

export default defineAdapter<IpadWechatEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  login: { mode: 'interactive', challenges: ['qrcode', 'link_verify'] },
  profile: {
    default: {
      messaging: {
        maxLength: 4000,
        segments: {
          supported: ['text', 'image', 'mention', 'reply'],
          // https URLs are passed to the SDK as is; base64 and local paths are read by the Endpoint.
          outboundMedia: ['url', 'path', 'base64'],
          interactive: 'text',
          markdown: 'text',
        },
      },
      delivery: { send: true, proactive: true },
    },
  },
  createAdapter: context => new IpadWechatAdapter(context),
});
