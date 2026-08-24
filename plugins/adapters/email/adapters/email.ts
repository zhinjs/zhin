/**
 * Convention entry: discover `adapters/email.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
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
  // image/audio/video/file 段映射为邮件附件：canonical MediaRef kind=url/path
  // 作 nodemailer attachment.path（URL 由 nodemailer 拉流、path 读盘），
  // kind=base64 直发（content + encoding）；kind=file 无邮件对应概念，丢弃留痕。
  // 邮件无交互面，交互段降级纯文本。
  segments: {
    outboundMedia: ['url', 'path', 'base64'],
    interactive: 'text',
  },
  create(context) {
    return new EmailEndpoint({
      id: context.id,
      config: resolveEmailConfig(context.config),
    });
  },
});
