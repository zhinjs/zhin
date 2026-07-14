/**
 * Per-orchestrator store for policy: 'once' tool approvals (ADR 0039 P1).
 */
export class ToolApprovalOnceStore {
  private readonly keys = new Set<string>();

  has(sessionId: string, toolName: string): boolean {
    return this.keys.has(`${sessionId}:${toolName}`);
  }

  add(sessionId: string, toolName: string): void {
    this.keys.add(`${sessionId}:${toolName}`);
  }

  clear(): void {
    this.keys.clear();
  }
}
