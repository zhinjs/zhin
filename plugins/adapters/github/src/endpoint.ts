/**
 * GithubEndpoint — lifecycle, outbound send, inbound admit.
 */
import path from 'node:path';
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId, DatabaseHost } from '@zhin.js/plugin-runtime';
import { GhClient } from './gh-client.js';
import { registerGithubAgentEndpoint } from './github-agent-deps.js';
import { lookupGithubOauthAccessToken } from './oauth-users.js';
import {
  enrichInboundContent,
  formatInboundContent,
  formatOutboundBody,
  parseChannelId,
  type GithubInboundComment,
  type ResolvedGithubConfig,
} from './protocol.js';
import { registerGithubWebhookRoutes } from './webhook.js';
import { WorkspaceManager } from './workspace-manager.js';

const logger = getLogger('github');

export interface GithubEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly http?: HttpHost;
  readonly database?: DatabaseHost;
  readonly config: ResolvedGithubConfig;
  readonly createClient?: (config: ResolvedGithubConfig) => GhClient;
}

export class GithubEndpoint implements EndpointInstance {
  readonly #options: GithubEndpointOptions;
  readonly gh: GhClient;
  readonly config: ResolvedGithubConfig;
  readonly name: string;
  #workspaceManager: WorkspaceManager | null = null;
  #routeReleases: HttpRouteRegistration[] = [];
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;

  constructor(options: GithubEndpointOptions) {
    this.#options = options;
    this.config = options.config;
    this.name = options.config.name;
    this.gh = options.createClient?.(options.config) ?? defaultCreateClient(options.config);
  }

  getAPI(): GhClient {
    return this.gh;
  }

  async getUserOrDefaultAPI(platform?: string, platformUid?: string): Promise<GhClient | null> {
    if (platform && platformUid) {
      const token = await lookupGithubOauthAccessToken(
        this.#options.database,
        platform,
        platformUid,
      );
      if (token) return this.gh.withToken(token);
    }
    return this.gh;
  }

  getClientId(): string | null {
    return this.gh.clientId || null;
  }

  getHost(): string | undefined {
    return this.config.host;
  }

  getAppSlug(): string | null {
    return this.gh.appSlug || null;
  }

  getInstallations() {
    return this.gh.installations || [];
  }

  getWorkspaceManager(): WorkspaceManager {
    if (this.#workspaceManager) return this.#workspaceManager;
    const workspaceRoot = this.config.workspaceRoot
      ?? path.join(process.cwd(), 'data', 'github-workspaces');
    this.#workspaceManager = new WorkspaceManager(this.gh, workspaceRoot);
    return this.#workspaceManager;
  }

  getDatabase(): DatabaseHost | undefined {
    return this.#options.database;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      const result = await this.gh.verifyAuth();
      if (!result.ok) throw new Error(`GitHub 认证失败: ${result.message}`);
      this.#unregisterAgent = registerGithubAgentEndpoint(this.name, this);
      if (this.config.webhookSecret) {
        if (!this.#options.http) {
          throw new TypeError('GitHub webhook_secret requires httpHostToken');
        }
        this.#routeReleases.push(...registerGithubWebhookRoutes(this.#options.http, this));
        logger.debug(formatCompact({
          endpoint: this.name,
          op: 'webhook',
          path: this.config.webhookPath,
        }));
      } else {
        logger.debug(formatCompact({
          endpoint: this.name,
          op: 'connect',
          mode: 'api-only',
          bot: this.gh.authenticatedUser,
        }));
      }
    } catch (error) {
      await this.stop();
      logger.error('Failed to connect GitHub endpoint:', error);
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
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
    this.#started = false;
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.name }));
  }

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    const parsed = parseChannelId(target);
    if (!parsed) throw new Error(`无效的 GitHub channel ID: ${target}`);
    const text = formatOutboundBody(payload);
    const r = parsed.type === 'issue'
      ? await this.gh.createIssueComment(parsed.repo, parsed.number, text)
      : await this.gh.createPRComment(parsed.repo, parsed.number, text);
    if (!r.ok) throw new Error(`发送失败: ${JSON.stringify(r.data)}`);
    logger.debug(formatCompact({
      op: 'github_send',
      endpoint: this.name,
      target,
      messageId: r.data.id,
    }));
    return String(r.data.id);
  }

  /** Test / internal: admit a parsed comment when open. */
  admit(comment: GithubInboundComment): void {
    if (!this.#open) return;
    const botUser = this.config.botLogin || this.gh.getBotLogin() || this.gh.authenticatedUser;
    if (botUser && comment.sender === botUser) return;
    const content = enrichInboundContent(
      formatInboundContent(comment.content),
      this.config,
      botUser ?? undefined,
      comment.repo,
    );
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target: comment.channelId,
      content,
      sender: comment.sender,
      id: comment.id,
      metadata: Object.freeze({
        endpoint: this.name,
        repo: comment.repo,
        kind: comment.kind,
        createdAt: comment.createdAt,
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'github_gateway_receive_failed',
        target: comment.channelId,
        error: err instanceof Error ? err.message : String(err),
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
