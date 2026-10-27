/**
 * `announcement_draft`（ADR 0037 §1.2，切片 B）：模型只能**建草稿**。
 *
 * - `risk: 'safe'`：只写一行 `ai_announcements`（`status=draft`、`created_via=model`），不提交审批、不发送。
 *   提交 / 审批 / 驳回 / 重发只经 Console；发送只在运营者批准之后由宿主执行。
 * - 目标会话缺省为当前会话（`group` / `channel`）；私聊里必须显式给 `scene_id`。
 * - 起草写 `kind=announcement`、`reason_code=announcement_drafted`、`actor=model` 审计（由存储写）。
 */
import {
  defineAgentTool,
  toolFeatureId,
  type AgentToolDefinition,
  type ToolExecutionContext,
} from '@zhin.js/tool';
import { MAX_ANNOUNCEMENT_CONTENT_CHARS, type AiAnnouncements } from '../announcements.js';

export const ANNOUNCEMENT_DRAFT_TOOL_NAME = 'announcement_draft';

export interface NativeAnnouncementToolFeature {
  readonly feature: typeof toolFeatureId;
  readonly name: string;
  readonly definition: Readonly<AgentToolDefinition<Record<string, unknown>, string>>;
}

export type AnnouncementStoreSource = () => AiAnnouncements | undefined;

const SCENE_ID_PATTERN = /^(group|channel):.+/u;

export function createNativeAnnouncementToolFeatures(source: AnnouncementStoreSource): readonly NativeAnnouncementToolFeature[] {
  return Object.freeze([
    Object.freeze({
      feature: toolFeatureId,
      name: ANNOUNCEMENT_DRAFT_TOOL_NAME,
      definition: defineAgentTool<Record<string, unknown>, string>({
        description: 'Create a group announcement DRAFT for operators to review in the Console. '
          + 'This never publishes anything: an operator must edit/submit/approve it before it is sent. '
          + 'Defaults to the current group; use it instead of sending a group notice directly.',
        inputSchema: Object.freeze({
          type: 'object',
          properties: Object.freeze({
            content: Object.freeze({ type: 'string', description: 'Announcement body (plain text).', maxLength: MAX_ANNOUNCEMENT_CONTENT_CHARS }),
            platform: Object.freeze({ type: 'string', description: 'Target platform; defaults to the current conversation platform.' }),
            scene_id: Object.freeze({ type: 'string', description: 'Target scene like group:<id>; defaults to the current group/channel.' }),
          }),
          required: Object.freeze(['content']),
        }),
        requiresApproval: 'never',
        risk: 'safe',
        execute: async (input, context) => draftAnnouncement(source, input, context),
      }) as Readonly<AgentToolDefinition<Record<string, unknown>, string>>,
    }),
  ]);
}

async function draftAnnouncement(
  source: AnnouncementStoreSource,
  input: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<string> {
  const store = source();
  if (!store) throw new Error('announcements are unavailable');
  const content = input.content;
  if (typeof content !== 'string' || !content.trim()) throw new TypeError('content is required');
  if (Array.from(content).length > MAX_ANNOUNCEMENT_CONTENT_CHARS) {
    throw new TypeError(`content exceeds ${MAX_ANNOUNCEMENT_CONTENT_CHARS} characters`);
  }
  const origin = context.origin;
  const im = origin.kind === 'im' ? origin : undefined;
  const platform = typeof input.platform === 'string' && input.platform.trim() ? input.platform.trim() : im?.platform;
  if (!platform) throw new TypeError('platform is required outside an IM conversation');
  let sceneId = typeof input.scene_id === 'string' && input.scene_id.trim() ? input.scene_id.trim() : undefined;
  if (!sceneId && im && (im.scope === 'group' || im.scope === 'channel')) sceneId = `${im.scope}:${im.sceneId}`;
  if (!sceneId || !SCENE_ID_PATTERN.test(sceneId)) throw new TypeError('scene_id must look like group:<id> or channel:<id>');
  const createdBy = context.principal?.subjectId?.trim() || 'model';
  const { record } = await store.create({
    platform,
    sceneId,
    content,
    createdBy,
    createdVia: 'model',
    // 同平台时记下当前 Bot 账号，发送时按它选 Endpoint。
    endpoint: im && im.platform === platform ? im.endpoint : null,
    turnId: context.turnId,
  });
  return `Announcement draft ${record.id} saved for ${platform} ${sceneId} (status: draft). `
    + 'It has NOT been sent: an operator must submit and approve it in the Console. Do not call a group-notice tool for it.';
}
