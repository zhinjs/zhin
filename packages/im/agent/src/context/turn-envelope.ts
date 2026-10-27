import { createPromptContextBlock, type TextContentBlock } from '@zhin.js/ai';
import { getFileMemoryContext, formatMemoryPathsHint } from '../memory-layers.js';
import type { TurnRequest } from '../turn/turn-ingress.js';
import { isLocale } from '@zhin.js/plugin-runtime';
import { SCENE_WAKE_METADATA_KEY } from '../scene-events.js';

export const TURN_CONTEXT_BEGIN = '[Turn context]';
export const TURN_CONTEXT_END = '[/Turn context]';

export type TurnContextView = Pick<TurnRequest, 'origin' | 'principal' | 'session'>
  & Partial<Pick<TurnRequest, 'policy' | 'input'>>;

/** Trusted turn metadata key the IM ingress sets for a turn nobody addressed. */
export const AMBIENT_ENGAGEMENT_METADATA_KEY = 'zhinEngagement';

const AMBIENT_ENGAGEMENT_LINE = 'Engagement: ambient. Nobody called you; you are reading the group chat and chose to look. '
  + 'Reply only if a group member like you would naturally chime in here; otherwise return {"messages":[]} and stay quiet.';

const SCENE_WAKE_ENGAGEMENT_LINE = 'Engagement: scene events. Nobody spoke; you woke up because of the [Scene events] listed for this turn. '
  + 'React only if a group member like you naturally would (welcome a newcomer, answer a poke); otherwise return {"messages":[]} and stay quiet.';

export interface TurnContextEnvelopeInput {
  turn?: TurnContextView;
  profileSummary?: string;
  sessionSummary?: string;
  /** 状态感知 `[Scene events]` 段（#996），与会话画像同块、ephemeral。 */
  sceneEvents?: string;
  toneHint?: string;
  deferredStats?: string;
  activeSkillsContext?: string;
  activeSkillBlocks?: readonly TextContentBlock[];
  quoteSystemHint?: string;
  modelLine?: string;
  sdk?: string;
  gitStatus?: string | null;
  agentsContext?: string;
  /** Rendered "already told the user" ledger (#730). */
  toldLedger?: string;
  /** BM25-recalled semantic memory for this message (#734). */
  relevantMemory?: string;
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
  return buildTurnContextBlocks(input).map(block => block.text).join('\n');
}

export function buildTurnContextBlocks(input: TurnContextEnvelopeInput): TextContentBlock[] {
  const blocks: TextContentBlock[] = [];
  const lines: string[] = [TURN_CONTEXT_BEGIN];
  const flush = () => {
    if (lines.length) blocks.push({ type: 'text', text: lines.splice(0).join('\n') });
  };
  const now = new Date();
  const locale = isLocale(input.turn?.input?.locale) ? input.turn.input.locale : 'zh-CN';
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeStr = now.toLocaleString(locale, { timeZone: tz });
  lines.push(`Time: ${timeStr} (${tz})`);

  if (input.modelLine?.trim()) lines.push(`Model: ${input.modelLine.trim()}`);
  if (input.sdk?.trim()) lines.push(`Sdk: ${input.sdk.trim()}`);
  if (input.gitStatus?.trim()) lines.push(input.gitStatus.trim());

  if (input.turn) {
    const display = input.turn.input;
    if (isLocale(display?.locale)) lines.push(`Reply language fallback: ${display.locale}.`);
    if (typeof display?.commandPrefix === 'string') {
      lines.push(`Chat command prefix: ${JSON.stringify(display.commandPrefix)}. Include it exactly once when showing a known command; do not infer it from history or invent command names.`);
      if (display.commandMenu) lines.push(`Command menu invocation: ${JSON.stringify(display.commandMenu)}.`);
    }
    lines.push(formatSessionContextLine(input.turn));
    lines.push(formatSenderContextLine(input.turn));
    if (input.turn.origin.kind === 'im' && input.turn.origin.messageId) {
      lines.push(`Current message id: ${JSON.stringify(input.turn.origin.messageId)}`);
    }
    if (input.turn.input?.metadata?.[SCENE_WAKE_METADATA_KEY] === true) lines.push(SCENE_WAKE_ENGAGEMENT_LINE);
    else if (input.turn.input?.metadata?.[AMBIENT_ENGAGEMENT_METADATA_KEY] === 'ambient') lines.push(AMBIENT_ENGAGEMENT_LINE);
    if (input.turn.policy?.filesystem) {
      const filesystem = input.turn.policy.filesystem;
      lines.push(`Workspace: ${filesystem.workingDirectory ?? filesystem.workspaceRoot} | access:${filesystem.access ?? 'workspace-write'}`);
    }
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
  if (input.toneHint?.trim()) lines.push(`[Tone hint] ${input.toneHint.trim()}`);
  if (input.activeSkillBlocks?.length) {
    flush();
    blocks.push(...input.activeSkillBlocks);
  } else if (input.activeSkillsContext?.trim()) lines.push(input.activeSkillsContext.trim());
  if (input.quoteSystemHint?.trim()) lines.push(input.quoteSystemHint.trim());
  if (input.agentsContext?.trim()) {
    flush();
    blocks.push(createPromptContextBlock('workspace-rules', input.agentsContext.trim()));
  }
  if (input.toldLedger?.trim()) lines.push(input.toldLedger.trim());
  if (input.relevantMemory?.trim()) lines.push(input.relevantMemory.trim());

  lines.push(TURN_CONTEXT_END);
  flush();
  // 会话画像（人物关系 + 会话上下文）与状态感知（#996 [Scene events]）只对本轮有效：独立成块并标记 ephemeral，
  // 存储前丢弃，之后的回合和新会话不会重放旧的 [Relationship] / [Session] / [Scene events]。
  const people = [input.profileSummary?.trim(), input.sessionSummary?.trim(), input.sceneEvents?.trim()].filter(Boolean);
  if (people.length) blocks.splice(1, 0, { type: 'text', text: people.join('\n'), ephemeral: true });
  return blocks;
}

export function prependTurnContextEnvelope(content: string, envelope: string | null | undefined): string {
  if (!envelope?.trim()) return content;
  return `${envelope.trim()}\n\n${content}`;
}
