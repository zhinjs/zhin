import { createEndpointSpecification, endpointSpec, type Endpoint, type EndpointSendRequest } from 'zhin.js/adapter';
/**
 * GithubEndpoint — lifecycle, outbound send, inbound admit.
 */
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
import { WorkspaceManager } from './workspace-manager.js';
import { lookupGithubOauthAccessToken } from './oauth-users.js';

export interface GithubEndpointOptions {
  readonly id: CapabilityId;
  readonly http?: HttpHost;
  readonly database?: PluginDatabaseHost;
  readonly config: ResolvedGithubConfig;
}

/**
 * GitHub 是代码协作面（issue/PR），无好友/群/频道等 IM 社交概念，
 * 不适用 EndpointManagement 语义端口；本 endpoint 不暴露该端口。
 */
export class GithubEndpoint extends GhClient implements Endpoint {
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start: signal => this.#startFramework(signal), open: () => this.#openFramework(), close: () => this.#closeFramework(),
    stop: () => this.#stopFramework(), send: request => this.#sendFramework(request),
  });
  #workspaceManager?: WorkspaceManager;
  get database() { return this.#options.database; }
  get host(): string | undefined { return this.#options.config.host; }
  async getUserOrDefaultApi(platform?: string, platformUid?: string): Promise<GhClient> {
    if (platform && platformUid) { const token = await lookupGithubOauthAccessToken(this.database, platform, platformUid); if (token) return this.withToken(token); }
    return this;
  }
  get workspaceManager(): WorkspaceManager { return this.#workspaceManager ??= new WorkspaceManager(this, this.config.workspaceRoot); }
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: GithubEndpointOptions;
  #routeReleases: HttpRouteRegistration[] = [];
  #open = false;
  #started = false;

  constructor(options: GithubEndpointOptions) {
    super({ host: options.config.host, appAuth: { appId: options.config.appId, privateKey: options.config.privateKey } });
    this.#logger = getAdapterLogger('github', options.config.id);
    this.#options = options;

  }

  get config(): ResolvedGithubConfig {
    return this.#options.config;
  }

  async #startFramework(signal: AbortSignal): Promise<void> {
    this.bindExecutionSignal(signal); signal.throwIfAborted();
    if (this.#started) return;
    this.#started = true;
    try {
      const result = await this.verifyAuth();
      signal.throwIfAborted();
      if (!result.ok) throw new Error(`GitHub 认证失败: ${result.message}`);
      if (this.#options.config.webhookSecret) {
        if (!this.#options.http) {
          throw new TypeError('GitHub webhook_secret requires httpHostToken');
        }
        this.#routeReleases.push(...registerGithubWebhookRoutes(this.#options.http, this));
        this.#logger.debug(formatCompact({
          endpoint: this.#options.config.id,
          op: 'webhook',
          path: this.#options.config.webhookPath,
        }));
      } else {
        this.#logger.debug(formatCompact({
          endpoint: this.#options.config.id,
          op: 'connect',
          mode: 'api-only',
          bot: this.authenticatedUser,
        }));
      }
    } catch (error) {
      await this.#stopFramework();
      this.#logger.error('Failed to connect GitHub endpoint:', error);
      throw error;
    }
  }

  #openFramework(): void {
    this.#open = true;
  }

  #closeFramework(): void {
    this.#open = false;
  }

  async #stopFramework(): Promise<void> {
    this.#open = false;
    for (const release of this.#routeReleases.splice(0)) release();
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async #sendFramework({ conversation, payload }: EndpointSendRequest): Promise<string> {
    const parsed = parseChannelId(conversation.id);
    if (!parsed) throw new Error(`无效的 GitHub conversation ID: ${conversation.id}`);
    const text = formatOutboundBody(payload);
    const r = parsed.type === 'issue'
      ? await this.createIssueComment(parsed.repo, parsed.number, text)
      : await this.createPRComment(parsed.repo, parsed.number, text);
    if (!r.ok) throw new Error(`发送失败: ${JSON.stringify(r.data)}`);
    this.#logger.debug(formatCompact({
      op: 'github_send',
      endpoint: this.#options.config.id,
      target: `${conversation.kind}:${conversation.id}`,
      messageId: r.data.id,
    }));
    return String(r.data.id);
  }

  /** Test / internal: admit a parsed comment when open. */
  admit(comment: GithubInboundComment, nativeEvent: unknown = comment): void {
    if (!this.#open) return;
    void this[endpointSpec].events.run(() => this.#admitComment(comment, nativeEvent)).catch(error => {
      this.#logger.warn(formatCompact({ op: 'github_gateway_receive_failed', error: error instanceof Error ? error.message : String(error) }));
    });
  }

  #admitComment(comment: GithubInboundComment, nativeEvent: unknown = comment): void {
    if (!this.#open) return;
    const botUser = this.#options.config.botLogin
      || this.getBotLogin()
      || this.authenticatedUser;
    if (botUser && comment.sender === botUser) return;
    const conversation = githubInboundConversation(String(this.#options.id), comment);
    const content = enrichInboundContent(
      formatInboundContent(comment.content),
      this.#options.config,
      botUser ?? undefined,
      comment.repo,
    );
    void this[endpointSpec].events.emit('message.receive', {
      event: nativeEvent,
      conversation,
      message: { conversation, id: comment.id },
      content,
      sender: { id: comment.sender, name: comment.sender },
      endpointId: this.#options.config.id,
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
    void this[endpointSpec].events.run(() => this[endpointSpec].events.platform(name, event)).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'github_platform_event_failed',
        event: name,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }
}

export function defaultCreateClient(config: ResolvedGithubConfig): GhClient {
  return new GhClient({
    host: config.host,
    appAuth: { appId: config.appId, privateKey: config.privateKey },
  });
}
