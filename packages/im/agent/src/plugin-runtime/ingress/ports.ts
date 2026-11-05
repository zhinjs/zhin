import type { AmbientEngagementConfig } from '@zhin.js/ai';
import type { SnapshotLease, SnapshotReader } from '@zhin.js/plugin-runtime';
import type {
  AIService,
  AiControlPlane,
  ApprovalReviewAgent,
  DecisionEventLog,
  TurnEvent,
  TurnRequest,
} from '../../index.js';
import type { DecisionObservation } from '../../decision/index.js';
import type { ApprovalJudgmentPort } from '../../session/index.js';
import type { AgentTraceRecorder } from '../agent-trace-runtime.js';
import type { SemanticMemoryRuntime } from '../native-semantic-memory-tools.js';
import type { ZhinAgent } from '../../zhin-agent/index.js';
import type { AmbientDecision } from './ambient-engagement.js';
import type { AnnouncementDispatcher } from './announcement-dispatch.js';
import type { MemberLifecycle } from './member-lifecycle.js';

export interface FoundationModelOperation {
  readonly lease: SnapshotLease;
  readonly bindingName: string;
  readonly turnId: string;
  readonly sessionKey: string;
  readonly signal: AbortSignal;
}

export interface FoundationModelSelection {
  readonly lease: SnapshotLease;
  readonly snapshots: SnapshotReader;
  readonly bindingName: string;
  readonly signal: AbortSignal;
}

export interface AgentIngressFoundationPort {
  readonly service: AIService;
  readonly agent: ZhinAgent;
  readonly traceRuntime: AgentTraceRecorder;
  readonly semanticMemory: SemanticMemoryRuntime | null;
  readonly approvalReviewer: ApprovalReviewAgent;
  readonly approvalJudgment: ApprovalJudgmentPort;
}

export interface ImApprovalCommandInput {
  readonly platform: string;
  readonly scope: 'private' | 'group' | 'channel';
  readonly sceneId: string;
  readonly senderId: string;
  readonly commandText: string | undefined;
}

export interface ImApprovalChannelPort {
  handleCommand(input: ImApprovalCommandInput): string | null;
}

export interface AgentAssistantStatusPort {
  bindAmbientConfig(read: () => AmbientEngagementConfig | undefined): void;
  bindDecisionEvents(read: () => DecisionEventLog | undefined): void;
  bindControlPlane(
    read: () => AiControlPlane | undefined,
    audit?: () => DecisionEventLog | undefined,
  ): void;
  bindSessionOps(
    read: () => ReturnType<ZhinAgent['getSessionOps']>,
    lifecycle: () => MemberLifecycle | undefined,
    audit?: () => DecisionEventLog | undefined,
  ): void;
  bindAnnouncements(
    read: () => ReturnType<ZhinAgent['getAnnouncements']>,
    dispatcher: () => AnnouncementDispatcher | undefined,
  ): void;
  bindSessionEvents(read: () => ReturnType<ZhinAgent['getSessionEvents']>): void;
  bindGroupRules(read: () => ReturnType<ZhinAgent['getGroupRules']>): void;
  bindUsageTraces(read: () => string | undefined): void;
  recordAmbient(group: string, decision: AmbientDecision): void;
  recordAmbientShadow(decisionEngage: boolean | undefined, judgeEngage: boolean | undefined): void;
  recordDecision(observation: DecisionObservation): void;
}

export function observeAgentTurnTrace(
  trace: AgentTraceRecorder,
  request: TurnRequest,
  downstream?: (event: TurnEvent) => void,
): (event: TurnEvent) => void {
  return (event) => {
    const tracedEvent: TurnEvent = event.type === 'turn_start'
      && request.origin.kind === 'im'
      && request.origin.messageId
      ? { ...event, sourceMessageId: request.origin.messageId }
      : event;
    trace.record(request.session.key, request.identity.turnId, tracedEvent);
    downstream?.(event);
  };
}
