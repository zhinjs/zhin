import { getFileMemoryContext, formatMemoryPathsHint } from '../memory-layers.js';
import type { TurnRequest } from '../turn/turn-ingress.js';

export const TURN_CONTEXT_BEGIN = '[Turn context]';
export const TURN_CONTEXT_END = '[/Turn context]';

export type TurnContextView = Pick<TurnRequest, 'origin' | 'principal' | 'session'>;

export interface TurnContextEnvelopeInput {
  turn?: TurnContextView;
  profileSummary?: string;
  toneHint?: string;
  deferredStats?: string;
  activeSkillsContext?: string;
  quoteSystemHint?: string;
  modelLine?: string;
  sdk?: string;
  agentsContext?: string;
}

export function formatSessionContextLine(turn: TurnContextView): string {
  const origin = turn.origin;
  if (origin.kind === 'im') {
    return `Session: platform:${origin.platform} | endpoint:${origin.endpoint} | ${origin.scope}_id:${origin.sceneId}`;
  }
  if (origin.kind === 'http') return `Session: origin:http | session_id:${origin.sessionId}`;
  if (origin.kind === 'a2a') return `Session: origin:a2a | task_id:${origin.taskId}`;
  if (origin.kind === 'schedule') return `Session: origin:schedule | job_id:${origin.jobId}`;
  return `Session: origin:internal | source:${origin.source}`;
}

export function formatSenderContextLine(turn: TurnContextView): string {
  const { principal } = turn;
  const roles = principal.roles.length > 0 ? principal.roles.join(',') : 'user';
  return principal.displayName?.trim()
    ? `Sender: id=${principal.subjectId} name=${principal.displayName.trim()} roles=${roles}`
    : `Sender: id=${principal.subjectId} roles=${roles}`;
}

export function buildTurnContextEnvelope(input: TurnContextEnvelopeInput): string | null {
  const lines: string[] = [];
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeStr = now.toLocaleString('zh-CN', { timeZone: tz });
  lines.push(`Time: ${timeStr} (${tz})`);

  if (input.modelLine?.trim()) lines.push(`Model: ${input.modelLine.trim()}`);
  if (input.sdk?.trim()) lines.push(`Sdk: ${input.sdk.trim()}`);

  if (input.turn) {
    lines.push(formatSessionContextLine(input.turn));
    lines.push(formatSenderContextLine(input.turn));
    if (input.turn.origin.kind === 'im') {
      const platform = input.turn.origin.platform;
      const sessionKey = input.turn.session.key;
      const memoryPaths = formatMemoryPathsHint(platform, sessionKey);
      if (memoryPaths) lines.push(`Memory paths: ${memoryPaths}`);
      const fileMemory = getFileMemoryContext(undefined, platform, sessionKey);
      if (fileMemory?.trim()) {
        lines.push('Memory snapshot:');
        lines.push(fileMemory.trim());
      }
    }
  }

  if (input.deferredStats?.trim()) lines.push(`Deferred catalog: ${input.deferredStats.trim()}`);
  if (input.profileSummary?.trim()) lines.push(input.profileSummary.trim());
  if (input.toneHint?.trim()) lines.push(`[Tone hint] ${input.toneHint.trim()}`);
  if (input.activeSkillsContext?.trim()) lines.push(input.activeSkillsContext.trim());
  if (input.quoteSystemHint?.trim()) lines.push(input.quoteSystemHint.trim());
  if (input.agentsContext?.trim()) lines.push(input.agentsContext.trim());

  return lines.length === 0
    ? null
    : `${TURN_CONTEXT_BEGIN}\n${lines.join('\n')}\n${TURN_CONTEXT_END}`;
}

export function prependTurnContextEnvelope(content: string, envelope: string | null | undefined): string {
  if (!envelope?.trim()) return content;
  return `${envelope.trim()}\n\n${content}`;
}
