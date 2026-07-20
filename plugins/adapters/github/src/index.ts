export {
  buildChannelId,
  enrichInboundContent,
  formatInboundContent,
  formatNotification,
  formatOutboundBody,
  normalizeWebhookPath,
  parseChannelId,
  parseIssueCommentInbound,
  parsePrReviewCommentInbound,
  parsePrReviewInbound,
  resolveGithubConfig,
  shouldAutoReplyRepo,
  verifyWebhookSignature,
  type GithubAdapterConfig,
  type GithubInboundComment,
  type GithubWireSegment,
  type ResolvedGithubConfig,
} from './protocol.js';

export * from './types.js';

export {
  getAdapter,
  getGithubAgentDeps,
  registerGithubAgentEndpoint,
  setGithubAgentDeps,
  type GithubAgentDeps,
  type GithubAgentEndpoint,
} from './github-agent-deps.js';

export { GhClient } from './gh-client.js';
export { WorkspaceManager } from './workspace-manager.js';
export {
  parseMessageChannel,
  issueBranchName,
  resolveWorkspaceBranch,
  formatChannelContext,
} from './github-channel-context.js';

export {
  GithubEndpoint,
  defaultCreateClient,
  type GithubEndpointOptions,
} from './endpoint.js';

export {
  GITHUB_OAUTH_USERS_TABLE,
  GITHUB_OAUTH_USERS_SCHEMA,
  defineGithubOauthUsersTable,
  lookupGithubOauthAccessToken,
} from './oauth-users.js';

export {
  registerGithubWebhookRoutes,
  handleGithubWebhookRequest,
  dispatchGithubWebhookPayload,
  type GithubWebhookHandler,
} from './webhook.js';
