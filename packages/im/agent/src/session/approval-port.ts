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
  | Readonly<{ status: 'approved'; decision: Exclude<ApprovalDecision, 'reject'> }>
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

/** Tool-result text for a non-approved outcome; phrased so the model does not blindly retry. */
export function formatApprovalDenial(outcome: Exclude<ApprovalOutcome, { status: 'approved' }>): string {
  switch (outcome.status) {
    case 'denied':
      if (outcome.by === 'reviewer') {
        return 'Tool call rejected by the automatic approval reviewer (no human was asked). '
          + 'Do not retry the same call; continue without it or tell the user it needs their explicit approval.';
      }
      return outcome.by === 'remembered'
        ? 'Tool call denied: the user already rejected this operation earlier in this conversation. Do not retry it.'
        : 'Tool call denied by the user. Do not retry it; continue without it or ask the user how to proceed.';
    case 'timed_out':
      return 'Tool call not approved: the approval request timed out without an answer. '
        + 'Do not retry automatically; tell the user the action is waiting for their approval.';
    case 'unavailable':
      return `Tool call not approved: no approval channel is available (${outcome.reason}). `
        + 'Do not retry it in this conversation.';
  }
}

export function isApprovalPortAvailable(port: ApprovalPort | undefined): port is ApprovalPort {
  return Boolean(port && port.available !== false);
}
