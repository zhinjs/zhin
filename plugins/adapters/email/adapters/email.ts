/**
 * Convention entry: discover `adapters/email.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { EmailEndpoint } from '../src/endpoint.js';
import {
  resolveEmailConfig,
  type EmailAdapterConfig,
} from '../src/protocol.js';

export { EmailEndpoint } from '../src/endpoint.js';
export type { EmailEndpointOptions } from '../src/endpoint.js';
export type {
  EmailImapFetchMessage,
  EmailImapTransport,
  EmailSmtpTransport,
} from '../src/transport.js';

export default defineAdapter<EmailAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    return new EmailEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      config: resolveEmailConfig(context.config),
    });
  },
});
