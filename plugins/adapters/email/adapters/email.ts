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
  // image/file 段映射为邮件附件：canonical MediaRef kind=url/path 均可作
  // nodemailer attachment.path（URL 由 nodemailer 拉流）；邮件无交互面，交互段降级纯文本。
  segments: {
    outboundMedia: ['url', 'path'],
    interactive: 'text',
  },
  create(context) {
    return new EmailEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      config: resolveEmailConfig(context.config),
    });
  },
});
