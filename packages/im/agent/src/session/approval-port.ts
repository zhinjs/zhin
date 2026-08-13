/** Blocking human-in-the-loop security authority. */
export interface ApprovalRequestInput {
  requestId: string;
  toolName: string;
  question: string;
  timeoutMs?: number;
  /** The adapter must settle promptly and deny when the owning Turn is cancelled. */
  signal: AbortSignal;
}

export interface ApprovalPort {
  /** False means this transport cannot make an approval decision for this turn. */
  readonly available?: boolean;
  requestApproval(input: ApprovalRequestInput): Promise<boolean>;
  resolveApproval?(requestId: string, approved: boolean): boolean;
}

export function isApprovalPortAvailable(port: ApprovalPort | undefined): port is ApprovalPort {
  return Boolean(port && port.available !== false);
}
