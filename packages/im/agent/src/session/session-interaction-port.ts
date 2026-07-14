/**
 * SessionInteractionPort — blocking HITL only (ADR 0041).
 * Stream events publish via AgentStreamBus separately.
 */
export interface ApprovalRequestInput {
  requestId: string;
  toolName: string;
  question: string;
  timeoutMs?: number;
}

export interface SessionInteractionPort {
  requestApproval(input: ApprovalRequestInput): Promise<boolean>;
  resolveApproval?(requestId: string, approved: boolean): boolean;
}
