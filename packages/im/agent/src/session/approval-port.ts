/** Blocking human-in-the-loop security authority. */
export interface ApprovalRequestInput {
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

export function isApprovalPortAvailable(port: ApprovalPort | undefined): port is ApprovalPort {
  return Boolean(port && port.available !== false);
}
