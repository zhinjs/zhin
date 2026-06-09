import type { MessageElement } from "zhin.js";

function segmentAtId(seg: MessageElement): string {
  if (seg.type !== "at" && seg.type !== "mention") return "";
  const data = seg.data as Record<string, unknown> | undefined;
  const raw = data?.user_id ?? data?.qq ?? data?.id;
  return raw == null ? "" : String(raw);
}

function textMentionsBot(text: string, botIds: string[]): boolean {
  for (const id of botIds) {
    const re = new RegExp(`@${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    if (re.test(text)) return true;
  }
  return false;
}

function stripInlineAtBot(text: string, botIds: string[]): string {
  let result = text;
  for (const id of botIds) {
    if (!id) continue;
    const re = new RegExp(`^@${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    result = result.replace(re, "");
  }
  return result.trimStart();
}

/**
 * 统一 QQ 群 @ 机器人前缀：
 * - 去掉正文前的 at 段与内联 @，使命令/文本从首段开始匹配
 * - 若曾 @ 机器人，在末尾追加规范 at 段，供 AI @ 触发器识别
 */
export function normalizeGroupAtPrefix(
  content: MessageElement[],
  botAtIds: string[],
  forceAt: boolean,
): MessageElement[] {
  const ids = [...new Set(botAtIds.map(String).filter(Boolean))];
  if (!ids.length || !Array.isArray(content)) return content;

  let mentioned = forceAt;
  const body: MessageElement[] = [];

  for (const seg of content) {
    if (seg.type === "at" || seg.type === "mention") {
      const uid = segmentAtId(seg);
      if (uid && ids.includes(uid)) {
        mentioned = true;
        continue;
      }
      body.push(seg);
      continue;
    }
    if (seg.type === "text" && seg.data && typeof seg.data === "object") {
      const raw = String((seg.data as { text?: string }).text ?? "");
      if (textMentionsBot(raw, ids)) mentioned = true;
      const stripped = stripInlineAtBot(raw, ids);
      if (stripped) {
        body.push({ ...seg, data: { ...(seg.data as object), text: stripped } });
      }
      continue;
    }
    body.push(seg);
  }

  while (body.length > 0 && body[0]?.type === "text") {
    const t = String((body[0].data as { text?: string })?.text ?? "").trim();
    if (t) break;
    body.shift();
  }

  if (mentioned) {
    const canonicalId = ids[0]!;
    body.push({ type: "at", data: { qq: canonicalId, id: canonicalId } });
  }

  return body.length ? body : content;
}
