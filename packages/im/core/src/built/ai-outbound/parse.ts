import { isCanonicalSegment } from '../segment-contract/assert.js';
import type { Segment } from '../segment-contract/types.js';
import type { ZhinAiOutboundPayload } from './types.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 解析单条 outbound segment（canonical 或 legacy kind/mode）。 */
export function parseOutboundSegment(raw: unknown): Segment | null {
  if (!isPlainObject(raw)) return null;

  const type =
    typeof raw.type === 'string' && raw.type.trim()
      ? raw.type.trim()
      : typeof raw.kind === 'string' && raw.kind.trim()
        ? raw.kind.trim()
        : undefined;
  if (!type) return null;

  const data = isPlainObject(raw.data) ? raw.data : {};
  const platform = isPlainObject(raw.platform) ? raw.platform : undefined;
  const segment = platform ? { type, data, platform } : { type, data };
  return isCanonicalSegment(segment) ? segment : null;
}

/** 去掉嵌入 JSON 候选末尾的 markdown 围栏（模型常见 ```json … ``` 误输出）。 */
export function trimTrailingMarkdownFence(raw: string): string {
  let s = raw.trim();
  const trailingFence = s.match(/^([\s\S]*?)\s*```\s*$/);
  if (trailingFence) s = trailingFence[1]!.trim();
  return s;
}

export function unwrapAiOutboundJsonCandidate(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
  if (fenced) return fenced[1]!.trim();
  const embeddedFence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (embeddedFence && trimmed.indexOf('{') >= 0) {
    return trimTrailingMarkdownFence(embeddedFence[1]!.trim());
  }
  return trimTrailingMarkdownFence(trimmed);
}

/** 从「正文 + 嵌入 JSON」混合文本中提取 AI outbound JSON（协作群常见误输出）。 */
export function extractEmbeddedAiOutboundJson(
  plain: string,
): { prose: string; jsonRaw: string } | null {
  const trimmed = plain.trim();
  if (!trimmed.includes('{')) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const jsonRaw = trimTrailingMarkdownFence(fenced[1]!.trim());
    const payload = parseAiOutboundJson(jsonRaw);
    if (payload?.mentions?.length && payload.text?.trim()) {
      const prose = trimmed.slice(0, fenced.index!).trim();
      return { prose, jsonRaw };
    }
  }

  let idx = trimmed.indexOf('{');
  while (idx >= 0) {
    const jsonRaw = trimTrailingMarkdownFence(trimmed.slice(idx).trim());
    const payload = parseAiOutboundJson(jsonRaw);
    if (payload?.mentions?.length && payload.text?.trim()) {
      return { prose: trimmed.slice(0, idx).trim(), jsonRaw };
    }
    idx = trimmed.indexOf('{', idx + 1);
  }
  return null;
}

export function parseAiOutboundJson(raw: string): ZhinAiOutboundPayload | null {
  const candidate = unwrapAiOutboundJsonCandidate(raw);
  if (!candidate.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : undefined;
    const mentionsRaw = parsed.mentions;
    const mentions = Array.isArray(mentionsRaw)
      ? mentionsRaw.map((m) => String(m).trim()).filter(Boolean)
      : undefined;
    const segmentsRaw = parsed.segments;
    const segments = Array.isArray(segmentsRaw)
      ? segmentsRaw
          .map((item) => parseOutboundSegment(item))
          .filter((s): s is Segment => s != null)
      : undefined;
    const extensions =
      parsed.extensions != null && typeof parsed.extensions === 'object' && !Array.isArray(parsed.extensions)
        ? (parsed.extensions as Record<string, unknown>)
        : undefined;

    if (!text && !mentions?.length && !segments?.length && !extensions) return null;
    if (mentions?.length && !text) return null;

    return { text, mentions, segments, extensions };
  } catch {
    return null;
  }
}
