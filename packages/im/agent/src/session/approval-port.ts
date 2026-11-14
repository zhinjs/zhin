/** Blocking human-in-the-loop security authority. */
export interface ApprovalRequestInput {
  /** Fresh human consent: no model reviewer, master shortcut, or remembered grant. */
  humanOnly?: boolean;
  requestId: string;
  /** Canonical session boundary for approval memory. */
  sessionKey?: string;
  /** Conversation shape controls which human approval scopes are meaningful. */
  conversationScope?: 'private' | 'group' | 'channel';
  /** Principal whose proposed operation is being reviewed. */
  requesterId?: string;
  toolName: string;
  /** Stable fingerprint for the concrete operation covered by a remembered grant. */
  scopeKey?: string;
  /** Allow the approval surface to offer a Host-lifetime session grant. */
  remember?: 'session';
  /**
   * What the answer is for (#1250). `authorization` (default): an approver with authority over the
   * operation decides it. `intent`: the turn's own initiator only confirms that they want this exact
   * action (the provenance gate). A surface may settle an `intent` request with an initiator-only
   * answer, reported as `scope: 'intent'`; that answer never satisfies an authorization requirement.
   */
  purpose?: 'authorization' | 'intent';
  /**
   * #1250 review: the policy behind this request needs the bot owner (sensitive files, shell, shared
   * global / platform memory, ADR 0056 §2). An admin initiator can never approve it for themselves.
   */
  requiresOwner?: boolean;
  /**
   * #1250 review: the policy explicitly lets an admin initiator approve this request themselves (allow once),
   * for example a tool declared `admin_approvable`. Default false: everything else needs the bot owner.
   */
  adminMayApprove?: boolean;
  question: string;
  timeoutMs?: number;
  /** The adapter must settle promptly and deny when the owning Turn is cancelled. */
  signal: AbortSignal;
}

export type ApprovalDecision =
  | 'reject'
  | 'approve-once'
  | 'approve-session'
  | 'approve-always';

export interface ApprovalDecisionMemory {
  recall(input: ApprovalRequestInput): boolean | undefined;
  remember(input: ApprovalRequestInput, decision: ApprovalDecision): void;
}

export interface ApprovalPort {
  /** False means this transport cannot make an approval decision for this turn. */
  readonly available?: boolean;
  /**
   * #1250 review: true when the port can settle `purpose: 'intent'` confirmations (the initiator confirms
   * their own intent) even though `available` is false because nobody with authority can be asked.
   */
  readonly intentAvailable?: boolean;
  requestApproval(input: ApprovalRequestInput): Promise<boolean>;
  resolveApproval?(requestId: string, approved: boolean): boolean;
}

export interface ApprovalDecisionPort extends ApprovalPort {
  requestApprovalDecision(input: ApprovalRequestInput): Promise<ApprovalDecision>;
}

/**
 * Why an approval request settled the way it did. A boolean cannot tell the
 * model whether a human said no, nobody answered, or nobody could be asked.
 */
export type ApprovalOutcome =
  | Readonly<{
    status: 'approved';
    decision: Exclude<ApprovalDecision, 'reject'>;
    /** `intent`: only the initiator confirmed their own intent; any authorization requirement still applies. */
    scope?: 'intent';
  }>
  | Readonly<{ status: 'denied'; by: 'user' | 'reviewer' | 'remembered' }>
  | Readonly<{ status: 'timed_out' }>
  | Readonly<{ status: 'unavailable'; reason: string }>;

export interface ApprovalOutcomePort extends ApprovalPort {
  requestApprovalOutcome(input: ApprovalRequestInput): Promise<ApprovalOutcome>;
}

/** Ask any port for a typed outcome; legacy boolean ports report a user decision. */
export async function requestApprovalOutcome(
  port: ApprovalPort,
  input: ApprovalRequestInput,
): Promise<ApprovalOutcome> {
  const outcomePort = port as Partial<ApprovalOutcomePort & ApprovalDecisionPort>;
  if (typeof outcomePort.requestApprovalOutcome === 'function') {
    return outcomePort.requestApprovalOutcome(input);
  }
  if (typeof outcomePort.requestApprovalDecision === 'function') {
    const decision = await outcomePort.requestApprovalDecision(input);
    return decision === 'reject' ? { status: 'denied', by: 'user' } : { status: 'approved', decision };
  }
  return await port.requestApproval(input)
    ? { status: 'approved', decision: 'approve-once' }
    : { status: 'denied', by: 'user' };
}

export function approvalOutcomeToDecision(outcome: ApprovalOutcome): ApprovalDecision {
  return outcome.status === 'approved' ? outcome.decision : 'reject';
}

/** What the model is told about the call it asked for, so the denial can name a workable next step. */
export interface ApprovalDenialContext {
  readonly toolName: string;
  /** High-risk category of the call (`schedule`, `shell`, …), when it has one. */
  readonly action?: string;
}

/** Why no approval could even be asked: nobody is present, or this conversation has no approval surface. */
export type ApprovalBlockReason = 'unattended' | 'no_channel';

/** Tool-result text for a non-approved outcome; phrased so the model does not blindly retry. */
export function formatApprovalDenial(
  outcome: Exclude<ApprovalOutcome, { status: 'approved' }>,
  context?: ApprovalDenialContext,
): string {
  const hint = context ? ` ${approvalAlternativeHint(context, outcome.status !== 'denied' || outcome.by !== 'user')}` : '';
  switch (outcome.status) {
    case 'denied':
      if (outcome.by === 'reviewer') {
        return 'Tool call rejected by the automatic approval reviewer (no human was asked). '
          + 'Do not retry the same call silently. If the user you are talking to owns this bot (their private chat), '
          + 'ask them whether to approve it and wait for their answer instead of abandoning the task; '
          + `otherwise continue without it or tell the user it needs their explicit approval.${hint}`;
      }
      return (outcome.by === 'remembered'
        ? 'Tool call denied: the user already rejected this operation earlier in this conversation. Do not retry it.'
        : 'Tool call denied by the user. Do not retry it; continue without it or ask the user how to proceed.') + hint;
    case 'timed_out':
      return 'Tool call not approved: the approval request timed out without an answer, which counts as a rejection. '
        + `Do not retry automatically; tell the user the action was not done because nobody confirmed it in time.${hint}`;
    case 'unavailable':
      return `Tool call not approved: no approval channel is available (${outcome.reason}). `
        + 'This is not a rejection by the user. Do not retry it in this conversation.' + hint;
  }
}

/**
 * Denial for a call that needed approval but could not ask anyone (#1250): tells an unattended turn
 * apart from a conversation that has no approval surface, and names where the user can act instead.
 */
export function formatApprovalBlocked(
  block: ApprovalBlockReason,
  context: ApprovalDenialContext,
  detail?: string,
): string {
  const hint = approvalAlternativeHint(context, true);
  if (block === 'unattended') {
    return 'Tool call not approved: this is an unattended turn (for example a scheduled task or a background event), '
      + 'so no person can confirm it here. Do not retry it in this turn. ' + hint;
  }
  return `Tool call not approved: approval required, but this conversation has no approval channel${detail ? ` (${detail})` : ''}. `
    + 'This is not an unattended turn and the user did not refuse; nobody here can confirm the action. '
    + 'Do not retry it in this conversation. ' + hint;
}

/**
 * What the user can do instead, and a guard against presenting a tool name as a chat command:
 * the model must not tell people to "type schedule_add".
 */
export function approvalAlternativeHint(context: ApprovalDenialContext, offerAlternative: boolean): string {
  const alternative = !offerAlternative ? '' : context.action === 'schedule'
    ? 'If the user still wants this scheduled task, tell them they can create it themselves in the Console under 「运维 → 定时任务」, or ask the bot owner to set it up. '
    : context.action === 'config'
      ? 'If the user still wants this change, tell them they can make it in the Console configuration pages, or ask the bot owner to do it. '
      : 'If the user still wants this, tell them it needs someone who can approve it: they can do it in the Console, or ask the bot owner in a private chat with the bot. ';
  return `${alternative}Tool names such as "${context.toolName}" are not chat commands; never tell the user to type a tool name.`;
}

/**
 * Whether `port` can settle a request of `purpose` (default `authorization`). A port that can only take
 * the initiator's intent confirmation reports unavailable for authorization requests (#1250 review).
 */
export function isApprovalPortAvailable(
  port: ApprovalPort | undefined,
  purpose: 'authorization' | 'intent' = 'authorization',
): port is ApprovalPort {
  if (!port) return false;
  if (port.available !== false) return true;
  return purpose === 'intent' && port.intentAvailable === true;
}
