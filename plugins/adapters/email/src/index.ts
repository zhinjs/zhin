export {
  addressListText,
  emailInboundConversation,
  formatInboundContent,
  formatInboundSegments,
  formatOutboundMail,
  htmlToText,
  parseEmailMessage,
  resolveEmailConfig,
  senderDisplayName,
  type EmailAdapterConfig,
  type EmailAttachmentsConfig,
  type EmailMessage,
  type EmailWireSegment,
  type ImapConfig,
  type ResolvedEmailConfig,
  type SavedEmailAttachment,
  type SmtpConfig,
} from './protocol.js';

export {
  EmailEndpoint,
  type EmailEndpointOptions,
} from './endpoint.js';

export {
  defaultCreateImap,
  defaultCreateSmtp,
  type EmailImapFetchMessage,
  type EmailImapTransport,
  type EmailSmtpTransport,
} from './transport.js';
