import { EmailAdapter } from '../../src/adapter.js';
/**
 * Convention entry: discover `adapters/email/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import {
  type EmailEndpointConfig,
} from '../../src/protocol.js';

export { EmailEndpoint } from '../../src/endpoint.js';
export type { EmailEndpointOptions } from '../../src/endpoint.js';
export type {
  EmailImapFetchMessage,
  EmailImapTransport,
  EmailSmtpTransport,
} from '../../src/transport.js';

export default defineAdapter<EmailEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  // image/audio/video/file 段映射为邮件附件：canonical MediaRef kind=url/path
  // 作 nodemailer attachment.path（URL 由 nodemailer 拉流、path 读盘），
  // kind=base64 直发（content + encoding）；kind=file 无邮件对应概念，投递前拒绝。
  // 邮件无 Bot 点击回调；验收须按能力判为不适用，Endpoint 直接调用拒绝交互。
  segments: {
    html: 'direct',
    outboundMedia: ['url', 'path', 'base64'],
    markdown: 'native',
    interactive: 'text',
  },
  createAdapter: () => new EmailAdapter(),
});
