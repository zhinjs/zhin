import { createHash } from 'node:crypto';
import { createPromptContextBlock, createPromptStateBlock, type TextContentBlock } from '@zhin.js/ai';
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
  observedAt?: number;
  profileSummary?: string;
  sessionSummary?: string;
  /** 状态感知 `[Scene events]` 段（#996），与会话画像同块、ephemeral。 */
  sceneEvents?: string;
  toneHint?: string;
  deferredStats?: string;
  activeSkillsContext?: string;
  activeSkillBlocks?: readonly TextContentBlock[];
  quoteSystemHint?: string;
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
  const stable: string[] = [];
  const current: string[] = [];
  const observedAt = input.observedAt ?? Date.now();
  if (input.gitStatus?.trim()) current.push(input.gitStatus.trim());

  if (input.turn) {
    const { origin } = input.turn;
    const display = input.turn.input;
    if (origin.kind === 'im') {
      const address = origin.conversation;
      const scope = createHash('sha256').update(JSON.stringify([
        origin.platform, origin.endpoint, origin.scope, origin.sceneId,
        address?.endpoint.adapter, address?.endpoint.id, address?.kind, address?.id,
        address?.parent?.kind, address?.parent?.id, address?.threadId ?? origin.threadId,
      ])).digest('hex');
      const state = display?.contextState;
      blocks.push(createPromptStateBlock(`session:${scope}`, 'Session', {
        adapter: address?.endpoint.adapter ?? origin.platform,
        endpoint: address?.endpoint.id ?? origin.endpoint,
        id: address?.id ?? origin.sceneId,
        name: address?.name ?? null,
        type: address?.kind ?? origin.scope,
        ...(address?.parent ? { parentType: address.parent.kind, parentId: address.parent.id } : {}),
        ...((address?.threadId ?? origin.threadId) ? { threadId: address?.threadId ?? origin.threadId! } : {}),
        muteAll: state?.conversation?.muteAll ?? null,
      }, observedAt));
      blocks.push(createPromptStateBlock(`bot:${scope}`, 'Bot', {
        id: state?.bot?.id ?? null,
        name: state?.bot?.name ?? null,
        platformRole: state?.bot?.platformRole ?? null,
        platformRoleError: state?.bot?.platformRoleError ?? null,
        mutedUntil: state?.bot?.mutedUntil ?? null,
        status: state?.bot?.status ?? null,
      }, observedAt));
      blocks.push(createPromptContextBlock(`session-rules:${scope}`, state?.conversation?.rules
        ? `Session rules (conversation data):\n${JSON.stringify(state.conversation.rules, null, 2)}`
        : 'Session rules: unknown.'));
    } else {
      blocks.push(createPromptContextBlock('session-identity', formatSessionContextLine(input.turn)));
    }
    if (isLocale(display?.locale)) current.push(`Reply language fallback: ${display.locale}.`);
    if (typeof display?.commandPrefix === 'string') {
      stable.push(`Chat command prefix: ${JSON.stringify(display.commandPrefix)}. Include it exactly once when showing a known command; do not infer it from history or invent command names.`);
      if (display.commandMenu) stable.push(`Command menu invocation: ${JSON.stringify(display.commandMenu)}.`);
    }
    if (display?.metadata?.[SCENE_WAKE_METADATA_KEY] === true) current.push(SCENE_WAKE_ENGAGEMENT_LINE);
    else if (display?.metadata?.[AMBIENT_ENGAGEMENT_METADATA_KEY] === 'ambient') current.push(AMBIENT_ENGAGEMENT_LINE);
    if (input.turn.policy?.filesystem) {
      const filesystem = input.turn.policy.filesystem;
      stable.push(`Workspace: ${filesystem.workingDirectory ?? filesystem.workspaceRoot}`);
      current.push(`Workspace access: ${filesystem.access ?? 'workspace-write'}`);
    }
    if (origin.kind === 'im') {
      const memoryPaths = formatMemoryPathsHint(origin.platform, input.turn.session.key);
      if (memoryPaths) stable.push(`Memory paths: ${memoryPaths}`);
    }
  }
  if (stable.length) blocks.push(createPromptContextBlock('session-guidance', stable.join('\n')));
  if (input.agentsContext?.trim()) blocks.push(createPromptContextBlock('workspace-rules', input.agentsContext.trim()));

  if (input.turn?.origin.kind === 'im') {
    const { origin, principal, session } = input.turn;
    const fileMemory = getFileMemoryContext(undefined, origin.platform, session.key).trim();
    const memoryScope = JSON.stringify([
      process.cwd(), session.key, principal.subjectId,
      origin.platform, origin.endpoint, origin.scope, origin.sceneId,
      origin.conversation?.endpoint.adapter, origin.conversation?.endpoint.id,
      origin.conversation?.kind, origin.conversation?.id,
      origin.conversation?.parent?.kind, origin.conversation?.parent?.id,
      origin.conversation?.threadId ?? origin.threadId,
    ]);
    const memoryKey = `file-memory:${createHash('sha256').update(memoryScope).digest('hex')}`;
    blocks.push(createPromptContextBlock(memoryKey, fileMemory
      ? `Memory snapshot:\n${fileMemory}` : 'Memory snapshot: not supplied for this turn.'));
  }
  if (input.activeSkillBlocks?.length) blocks.push(...input.activeSkillBlocks);
  else if (input.activeSkillsContext?.trim()) blocks.push(createPromptContextBlock('active-skills', input.activeSkillsContext.trim()));
  if (input.deferredStats?.trim()) blocks.push(createPromptContextBlock('deferred-catalog-summary', `Deferred catalog: ${input.deferredStats.trim()}`));
  if (input.quoteSystemHint?.trim()) blocks.push(createPromptContextBlock('quote-guidance', input.quoteSystemHint.trim()));
  if (input.toneHint?.trim()) current.push(`[Tone hint] ${input.toneHint.trim()}`);
  if (input.toldLedger?.trim()) current.push(input.toldLedger.trim());
  if (input.relevantMemory?.trim()) current.push(input.relevantMemory.trim());
  if (current.length) blocks.push({ type: 'text', text: [TURN_CONTEXT_BEGIN, ...current, TURN_CONTEXT_END].join('\n') });
  const people = [input.profileSummary?.trim(), input.sessionSummary?.trim(), input.sceneEvents?.trim()].filter(Boolean);
  if (people.length) blocks.push({ type: 'text', text: people.join('\n'), ephemeral: true });
  return blocks;
}

export function prependTurnContextEnvelope(content: string, envelope: string | null | undefined): string {
  if (!envelope?.trim()) return content;
  return `${envelope.trim()}\n\n${content}`;
}
