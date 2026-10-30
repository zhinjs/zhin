import { Adapter, type AdapterContext, type EndpointCreationContext } from 'zhin.js/adapter';
import { httpHostToken } from '@zhin.js/host-http';
import { WebClient, type WebClientOptions } from '@slack/web-api';
import { SlackEndpoint } from './endpoint.js';
import { slackWebClientOptions } from './web-client.js';
import { createSlackWebApiAgent } from './web-api-proxy.js';
import { resolveSlackConfig, type SlackEndpointConfig } from './protocol.js';
import type { SlackClientEventMap } from './client.js';

export class SlackAdapter extends Adapter<SlackEndpoint, SlackEndpointConfig, SlackClientEventMap> {
  constructor(private readonly context: AdapterContext<SlackEndpointConfig>, private readonly webOptions: WebClientOptions = {}) { super(); }
  override get configurationIdentityFields(): readonly string[] { return ['id']; }
  override get configurationIdentityProbeFields(): readonly string[] { return ['token', 'appToken', 'signingSecret']; }
  override get configurationUpdateFields(): readonly string[] { return ['token', 'appToken', 'signingSecret', 'socketMode',
    'webhookPath', 'clientPingTimeout', 'webApiProxy', 'webApiProxy.port', 'streamProxy', 'streamProxy.port', 'streamProxy.serverName']; }
  protected override validateConfiguration(config: SlackEndpointConfig): void { resolveSlackConfig(config); }
  protected override async identifyConfiguration(input: SlackEndpointConfig, signal: AbortSignal, changedFields: readonly string[]): Promise<string | undefined> {
    // Neither the app-level token nor the callback signing secret has a readonly identity API.
    if (changedFields.some(field => field !== 'token')) return undefined;
    const config = resolveSlackConfig(input);
    const agent = config.webApiProxy ? createSlackWebApiAgent(config.webApiProxy) : undefined;
    const client = new WebClient(config.token, slackWebClientOptions({ ...this.webOptions, ...(agent ? { agent } : {}),
      requestInterceptor: request => { request.signal = signal; return request; } }));
    try {
      const me = await client.auth.test();
      if (typeof me.team_id !== 'string' || !me.team_id.trim()
        || typeof me.user_id !== 'string' || !me.user_id.trim()) throw new Error('Slack identity response is incomplete');
      return JSON.stringify(['slack', me.team_id, me.user_id]);
    } finally { agent?.destroy(); }
  }
  protected createEndpoint(input: SlackEndpointConfig, execution: EndpointCreationContext): SlackEndpoint {
    const config = resolveSlackConfig(input);
    const webApiAgent = config.webApiProxy ? createSlackWebApiAgent(config.webApiProxy) : undefined;
    try { return new SlackEndpoint({ id: execution.canonicalId, config, webApiAgent, webOptions: this.webOptions,
      ...(config.mode === 'http' ? { http: this.context.use(httpHostToken) } : {}) }); }
    catch (error) { webApiAgent?.destroy(); throw error; }
  }
}
