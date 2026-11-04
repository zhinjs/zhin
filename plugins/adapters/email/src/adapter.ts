import { identifyEmailConfiguration } from './identity.js';
import { Adapter, type EndpointCreationContext } from 'zhin.js/adapter';
import { EmailEndpoint } from './endpoint.js';
import { resolveEmailConfig, type EmailEndpointConfig } from './protocol.js';
import type { EmailClientEventMap } from './client.js';

export class EmailAdapter extends Adapter<EmailEndpoint, EmailEndpointConfig, EmailClientEventMap> {
  override get configurationIdentityFields(): readonly string[] { return ['id', 'smtp.host', 'smtp.auth.user', 'imap.host', 'imap.user']; }
  override get configurationUpdateFields(): readonly string[] { return ['smtp.port', 'smtp.secure', 'smtp.serverName', 'smtp.auth.pass', 'imap.port', 'imap.tls', 'imap.serverName', 'imap.password', 'imap.checkInterval', 'imap.reconnectInterval', 'imap.mailbox', 'imap.markSeen', 'attachments.enabled', 'attachments.downloadPath', 'attachments.maxFileSize', 'attachments.allowedTypes']; }
  get configurationIdentityProbeFields(): readonly string[] { return ['smtp.auth.pass', 'imap.password']; }
  protected override identifyConfiguration(input: EmailEndpointConfig, signal: AbortSignal): Promise<string> {
    return identifyEmailConfiguration(resolveEmailConfig(input), signal);
  }
  protected override validateConfiguration(config: EmailEndpointConfig): void { resolveEmailConfig(config); }
  protected createEndpoint(input: EmailEndpointConfig, execution: EndpointCreationContext): EmailEndpoint {
    const config = resolveEmailConfig(input);
    return new EmailEndpoint({ id: execution.canonicalId, config });
  }
}

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly 'email': EmailAdapter; }
}
