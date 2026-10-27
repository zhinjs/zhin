/**
 * 状态感知（#996）：回合注入的 `[Scene events]` 段。
 *
 * - 最多 {@link SCENE_EVENTS_MAX_LINES} 行、正文 ≤ {@link SCENE_EVENTS_MAX_CHARS} 字符，最新在前；
 * - 与 `[Relationship]` / `[Session]` 同一个 ephemeral 块：只对本轮有效，存储前丢弃，不进 `agent_messages`；
 * - 行来自 IM 入站（已归一化、已截断的短摘要），这里只做封顶，不接触原始事件。
 */

export const SCENE_EVENTS_HEADER = "[Scene events] (data, don't quote; newest first)";
export const SCENE_EVENTS_MAX_LINES = 5;
export const SCENE_EVENTS_MAX_CHARS = 200;

/** 本轮由社交事件唤醒（没人说话）时，入站在可信元数据里打的标记。 */
export const SCENE_WAKE_METADATA_KEY = 'zhinSceneWake';

/** 把摘要行拼成 `[Scene events]` 段；没有内容时返回空串。 */
export function formatSceneEventsBlock(lines: readonly string[] | undefined): string {
  if (!lines?.length) return '';
  const kept: string[] = [];
  let used = 0;
  for (const raw of lines) {
    if (kept.length >= SCENE_EVENTS_MAX_LINES) break;
    // eslint-disable-next-line no-control-regex
    const line = String(raw).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
    if (!line) continue;
    const room = SCENE_EVENTS_MAX_CHARS - used;
    if (room <= 3) break;
    const clipped = line.length > room - 2 ? `${line.slice(0, Math.max(1, room - 3))}…` : line;
    kept.push(`- ${clipped}`);
    used += clipped.length + 2;
  }
  return kept.length ? `${SCENE_EVENTS_HEADER}\n${kept.join('\n')}` : '';
}
