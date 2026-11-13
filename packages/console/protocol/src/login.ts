/**
 * Login Assist v2 wire types (ADR 0058). Structural copies of the `@zhin.js/core` LoginAssist
 * model: the Console stack does not depend on IM layers.
 */

export type ConsoleLoginChallengeKind =
  | 'qrcode' | 'link_verify' | 'slider' | 'sms' | 'device' | 'auth' | 'confirm' | 'other';
export type ConsoleLoginFlowState = 'active' | 'online' | 'failed' | 'cancelled' | 'expired';
export type ConsoleLoginStepKind = 'connect' | 'challenge' | 'verifying' | 'info';
export type ConsoleLoginStepStatus = 'active' | 'done' | 'failed' | 'skipped';
export type ConsoleLoginErrorCode =
  | 'code_invalid' | 'rate_limited' | 'challenge_expired' | 'risk_blocked'
  | 'credential_invalid' | 'network' | 'unknown';
export type ConsoleLoginOutcomeResult =
  | 'accepted' | 'rejected' | 'expired' | 'needs_new_challenge' | 'online' | 'failed';
export type ConsoleLoginNextAction = 'retry_input' | 'refresh_challenge' | 'relogin' | 'wait' | 'none';

export interface ConsoleLoginOutcome {
  readonly result: ConsoleLoginOutcomeResult;
  readonly code?: ConsoleLoginErrorCode;
  /** Sanitized single line; never contains submitted values. */
  readonly message?: string;
  readonly next?: ConsoleLoginNextAction;
  readonly retryAfterMs?: number;
}

export interface ConsoleLoginChallengeAction {
  readonly id: string;
  readonly label: string;
  readonly variant: 'primary' | 'secondary' | 'danger';
  readonly requiresInput?: boolean;
  readonly cooldownMs?: number;
}

export interface ConsoleLoginChallengeInput {
  readonly kind: 'none' | 'code' | 'ticket' | 'text';
  readonly label: string;
  readonly pattern?: string;
  readonly patternHint?: string;
  readonly length?: number;
  readonly secret?: boolean;
  readonly extract?: 'ticket-json-or-url';
}

export type ConsoleLoginHelpStep = string | Readonly<{
  text: string;
  blockId?: string;
  doneWhen?: 'copied' | 'opened' | 'manual';
}>;

export interface ConsoleLoginChallengeHelp {
  readonly short: string;
  readonly steps?: readonly ConsoleLoginHelpStep[];
  readonly warning?: string;
}

export type ConsoleLoginChallengeBlock =
  | Readonly<{
    kind: 'copy';
    id: string;
    label: string;
    /** Empty and `redacted: true` when sensitive material was removed. */
    content: string;
    format: 'json' | 'script' | 'text';
    sensitive?: boolean;
    collapsed?: boolean;
    collapsedLabel?: string;
    bookmarklet?: boolean;
    thenOpen?: string;
    redacted?: boolean;
  }>
  | Readonly<{ kind: 'link'; id?: string; label: string; url: string; showQr?: boolean }>
  | Readonly<{ kind: 'note'; id?: string; text: string; tone?: 'info' | 'warning' }>;

export interface ConsoleLoginChallengeMedia {
  readonly qrImage?: string;
  /** Event payloads omit the QR image; read it with `login.flow.get`. */
  readonly qrImageOmitted?: boolean;
  /** Event payloads omit verification links (`link`, `captcha`, link blocks); read them with `login.flow.get`. */
  readonly linkOmitted?: boolean;
  readonly link?: Readonly<{ url: string; label: string }>;
  readonly expiresAt?: number;
  readonly refreshable?: boolean;
  /** Hosted captcha helper: open `helperUrl` (or the default) with this query in a popup. */
  readonly captcha?: Readonly<{ provider: 'tencent'; query: string; helperUrl?: string }>;
}

export interface ConsoleLoginChallenge {
  readonly id: string;
  readonly kind: ConsoleLoginChallengeKind;
  readonly title: string;
  readonly help?: ConsoleLoginChallengeHelp;
  readonly blocks?: readonly ConsoleLoginChallengeBlock[];
  readonly media?: ConsoleLoginChallengeMedia;
  readonly input?: ConsoleLoginChallengeInput;
  readonly actions: readonly ConsoleLoginChallengeAction[];
  readonly expiresAt?: number;
}

export interface ConsoleLoginStep {
  readonly id: string;
  readonly kind: ConsoleLoginStepKind;
  readonly status: ConsoleLoginStepStatus;
  readonly title: string;
  readonly titleKey?: string;
  readonly detail?: string;
  readonly at: number;
  readonly endedAt?: number;
  readonly challenge?: ConsoleLoginChallenge;
  readonly taskId?: string;
  readonly outcome?: ConsoleLoginOutcome;
}

export interface ConsoleLoginEndpointIdentity {
  readonly canonicalId: string;
  readonly instanceId: string;
  readonly epoch: number;
  readonly incarnationId: string;
}

/** `endpoint.login.flow` payload and `login.flow.*` row. Dedupe by `id`; highest `revision` wins. */
export interface ConsoleLoginFlow {
  readonly id: string;
  readonly adapter: string;
  readonly endpointKey: string;
  readonly endpointIdentity?: ConsoleLoginEndpointIdentity;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly revision: number;
  readonly attempt: number;
  readonly state: ConsoleLoginFlowState;
  readonly currentStep?: string;
  readonly steps: readonly ConsoleLoginStep[];
  readonly lastOutcome?: ConsoleLoginOutcome;
  readonly pendingConfirmation?: boolean;
  readonly activeTaskId?: string;
}

/** Legacy `endpoint.login.pending` / `endpoint.login.expired` payload (LoginAssist task). */
export interface ConsoleLoginTask {
  readonly id: string;
  readonly adapter: string;
  readonly endpointKey: string;
  readonly endpointIdentity?: ConsoleLoginEndpointIdentity;
  readonly type: 'qrcode' | 'sms' | 'slider' | 'device' | 'auth' | 'other';
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: number;
  readonly expiresAt?: number;
  readonly flowId?: string;
  readonly challengeId?: string;
}

/** `defineAdapter({ login })` as reported on Endpoint rows. */
export interface ConsoleAdapterLoginDeclaration {
  readonly mode: 'interactive' | 'credential' | 'external';
  readonly challenges?: readonly ConsoleLoginChallengeKind[];
  readonly relogin?: boolean;
  readonly refreshQr?: boolean;
}

/** `login.submit` answer: legacy string, or the chosen action with its input values. */
export type ConsoleLoginSubmitValue = string | Readonly<{ action: string; values?: Readonly<Record<string, string>> }>;

/** `login.submit` with `wait: true`. */
export type ConsoleLoginSubmitWaitReply =
  | Readonly<{ accepted: true; outcome: ConsoleLoginOutcome; flow: ConsoleLoginFlow }>
  | Readonly<{ accepted: true; pending: true; flow?: ConsoleLoginFlow }>;

/** Error code of `login.relogin` / `login.refresh` when the Adapter offers no such action. */
export const CONSOLE_LOGIN_UNSUPPORTED = 'unsupported' as const;
