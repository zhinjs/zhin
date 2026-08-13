/**
 * HTTP approval park adapter — instance-scoped waiter (ADR 0041).
 */
import { HttpApprovalWaiter } from './http-approval-waiter.js';
import type { ApprovalPort, ApprovalRequestInput } from './approval-port.js';

export class HttpApprovalAdapter implements ApprovalPort {
  readonly waiter = new HttpApprovalWaiter();

  async requestApproval(input: ApprovalRequestInput): Promise<boolean> {
    try {
      return await this.waiter.wait(input.requestId, input.timeoutMs ?? 300_000, input.signal);
    } catch {
      return false;
    }
  }

  resolveApproval(requestId: string, approved: boolean): boolean {
    return this.waiter.resolve(requestId, approved);
  }
}
