import { Endpoint } from 'zhin.js/adapter';
/**
 * GithubEndpoint — lifecycle, outbound send, inbound admit.
 */
import { type EndpointSendRequest } from 'zhin.js/adapter';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId, PluginDatabaseHost } from 'zhin.js';
import { GhClient } from './gh-client.js';
import {
  enrichInboundContent,
  formatInboundContent,
  formatOutboundBody,
  githubInboundConversation,
  parseChannelId,
  type GithubInboundComment,
  type ResolvedGithubConfig,
} from './protocol.js';
import { registerGithubWebhookRoutes } from './webhook.js';
import { GithubClient } from './client.js';

export interface GithubEndpointOptions {
  readonly id: CapabilityId;
  readonly http?: HttpHost;
  readonly database?: PluginDatabaseHost;
  readonly config: ResolvedGithubConfig;
  readonly createClient?: (config: ResolvedGithubConfig) => GhClient;
}

/**
 * GitHub 是代码协作面（issue/PR），无好友/群/频道等 IM 社交概念，
 * 不适用 EndpointManagement 语义端口；本 endpoint 不暴露该端口。
 */
export class GithubEndpoint extends Endpoint<GithubClient> {
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: GithubEndpointOptions;
  readonly client: GithubClient;
  #routeReleases: HttpRouteRegistration[] = [];
  #open = false;
  #started = false;

  constructor(options: GithubEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('github', options.config.id);
    this.#options = options;
    const api = options.createClient?.(options.config) ?? defaultCreateClient(options.config);
    this.client = new GithubClient(options.config.id, api, options.config, options.database);
  }

  get config(): ResolvedGithubConfig {
    return this.client.config;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      const result = await this.client.api.verifyAuth();
      if (!result.ok) throw new Error(`GitHub 认证失败: ${result.message}`);
      if (this.client.config.webhookSecret) {
        if (!this.#options.http) {
          throw new TypeError('GitHub webhook_secret requires httpHostToken');
        }
        this.#routeReleases.push(...registerGithubWebhookRoutes(this.#options.http, this));
        this.#logger.debug(formatCompact({
          endpoint: this.client.name,
          op: 'webhook',
          path: this.client.config.webhookPath,
        }));
      } else {
        this.#logger.debug(formatCompact({
          endpoint: this.client.name,
          op: 'connect',
          mode: 'api-only',
          bot: this.client.api.authenticatedUser,
        }));
      }
    } catch (error) {
      await this.stop();
      this.#logger.error('Failed to connect GitHub endpoint:', error);
      throw error;
    }
  }

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  async stop(): Promise<void> {
    this.#open = false;
    for (const release of this.#routeReleases.splice(0)) release();
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const parsed = parseChannelId(conversation.id);
    if (!parsed) throw new Error(`无效的 GitHub conversation ID: ${conversation.id}`);
    const text = formatOutboundBody(payload);
    const r = parsed.type === 'issue'
      ? await this.client.api.createIssueComment(parsed.repo, parsed.number, text)
      : await this.client.api.createPRComment(parsed.repo, parsed.number, text);
    if (!r.ok) throw new Error(`发送失败: ${JSON.stringify(r.data)}`);
    this.#logger.debug(formatCompact({
      op: 'github_send',
      endpoint: this.client.name,
      target: `${conversation.kind}:${conversation.id}`,
      messageId: r.data.id,
    }));
    return String(r.data.id);
  }

  /** Test / internal: admit a parsed comment when open. */
  admit(comment: GithubInboundComment): void {
    if (!this.#open) return;
    const botUser = this.client.config.botLogin
      || this.client.api.getBotLogin()
      || this.client.api.authenticatedUser;
    if (botUser && comment.sender === botUser) return;
    const conversation = githubInboundConversation(String(this.#options.id), comment);
    const content = enrichInboundContent(
      formatInboundContent(comment.content),
      this.client.config,
      botUser ?? undefined,
      comment.repo,
    );
    void this.emit('message.receive', {
      conversation,
      message: { conversation, id: comment.id },
      content,
      sender: { id: comment.sender, name: comment.sender },
      endpointId: this.client.name,
      metadata: Object.freeze({
        repo: comment.repo,
        kind: comment.kind,
        createdAt: comment.createdAt,
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'github_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  admitPlatform(name: string, event: unknown): void {
    if (!this.#open) return;
    void this.emitPlatform(name, event).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'github_platform_event_failed',
        event: name,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }
}

export function defaultCreateClient(config: ResolvedGithubConfig): GhClient {
  const appAuth = config.appId && config.privateKey
    ? { appId: config.appId, privateKey: config.privateKey }
    : undefined;
  return new GhClient({ host: config.host, appAuth });
}
