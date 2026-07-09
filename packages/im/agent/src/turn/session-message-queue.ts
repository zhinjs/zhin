import type { AgentMessage } from '@zhin.js/ai';
import type { QueueMode } from '@zhin.js/ai';

function normalizeMessages(input: AgentMessage | AgentMessage[]): AgentMessage[] {
  return Array.isArray(input) ? input : [input];
}

/** Per-sessionKey steering / follow-up queues (ADR 0009 D6 / Grill #13). */
export class SessionMessageQueue {
  private steering: AgentMessage[] = [];
  private followUp: AgentMessage[] = [];

  constructor(
    readonly steeringMode: QueueMode,
    readonly followUpMode: QueueMode,
  ) {}

  pushSteering(input: AgentMessage | AgentMessage[]): void {
    this.steering.push(...normalizeMessages(input));
  }

  pushFollowUp(input: AgentMessage | AgentMessage[]): void {
    this.followUp.push(...normalizeMessages(input));
  }

  drainSteering(): AgentMessage[] {
    if (this.steering.length === 0) return [];
    if (this.steeringMode === 'all') {
      return this.steering.splice(0);
    }
    return this.steering.splice(0, 1);
  }

  drainFollowUp(): AgentMessage[] {
    if (this.followUp.length === 0) return [];
    if (this.followUpMode === 'all') {
      return this.followUp.splice(0);
    }
    return this.followUp.splice(0, 1);
  }

  clearSteering(): void {
    this.steering = [];
  }

  clearFollowUp(): void {
    this.followUp = [];
  }

  hasFollowUp(): boolean {
    return this.followUp.length > 0;
  }

  steeringDepth(): number {
    return this.steering.length;
  }

  followUpDepth(): number {
    return this.followUp.length;
  }
}
