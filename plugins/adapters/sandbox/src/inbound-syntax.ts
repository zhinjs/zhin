/**
 * Typed inbound syntax of the Sandbox composer (#1250 `sandbox-typed-media-syntax-sent-as-text`).
 *
 * One table drives three places, so they cannot drift:
 * - the page's 「快捷操作与语法」 list renders exactly {@link SANDBOX_INBOUND_SYNTAX};
 * - the page expands typed tokens before sending ({@link expandSandboxInboundSyntax});
 * - the endpoint expands the same tokens on every text segment it receives (raw WebSocket clients).
 *
 * The segments are the ones the composer buttons insert ({@link sandboxInboundMediaSegment}), so a
 * typed `[image:URL]` and a picked image are the same inbound message. A token whose link is not an
 * accepted URL stays text and is reported, never sent as a broken media segment.
 *
 * Browser-safe: no Node imports (the page bundles this file).
 */

export type SandboxInboundSyntaxKind = 'mention' | 'face' | 'image' | 'video' | 'audio' | 'file';

export interface SandboxInboundSegment {
  readonly type: string;
  readonly data: Record<string, unknown>;
}

export interface SandboxInboundSyntax {
  readonly kind: SandboxInboundSyntaxKind;
  /** What the hint list shows, e.g. `[image:URL]`. */
  readonly syntax: string;
  /** Inbound segment type the token becomes. */
  readonly segmentType: string;
  /** zh-CN label (the page localizes it through `sandboxText`). */
  readonly label: string;
  /** A valid instance, used by the guard test. */
  readonly example: string;
}

/** Every typed form the parser understands, in hint-list order. */
export const SANDBOX_INBOUND_SYNTAX: readonly SandboxInboundSyntax[] = Object.freeze([
  { kind: 'mention', syntax: '[@名称]', segmentType: 'mention', label: '@某人（写机器人的 ID 或昵称即 @机器人）', example: '[@alice]' },
  { kind: 'face', syntax: '[face:ID]', segmentType: 'face', label: '表情', example: '[face:14]' },
  { kind: 'image', syntax: '[image:URL]', segmentType: 'image', label: '图片', example: '[image:https://example.com/a.png]' },
  { kind: 'video', syntax: '[video:URL]', segmentType: 'video', label: '视频', example: '[video:https://example.com/a.mp4]' },
  { kind: 'audio', syntax: '[audio:URL]', segmentType: 'audio', label: '语音 / 音频', example: '[audio:https://example.com/a.mp3]' },
  { kind: 'file', syntax: '[file:URL]', segmentType: 'file', label: '文件', example: '[file:https://example.com/report.pdf]' },
].map((entry) => Object.freeze(entry as SandboxInboundSyntax)));

export type SandboxMediaKind = 'image' | 'video' | 'audio' | 'file';

/** A token the parser recognised but did not turn into a segment (its link is not accepted). */
export interface SandboxInboundSyntaxIssue {
  readonly kind: SandboxInboundSyntaxKind;
  readonly token: string;
  readonly reason: 'invalid_url';
}

const TOKEN = /\[(?:@([^\[\]\n]{1,64})|face:(\d{1,6})|(image|video|audio|file):([^\[\]\n]{1,4096}))\]/gu;

const DATA_URL = /^data:(([a-z]+)\/[a-z0-9.+-]+)(?:;[a-z0-9=.+-]+)*;base64,([a-z0-9+/=\s]+)$/iu;

/**
 * Inline media types a `data:` link may declare: the ones the Console renders inline
 * (`resolveMediaSrc` in `@zhin.js/client`). Script-capable or unrendered types (`image/svg+xml`,
 * `text/html`, …) stay text, so a declared `mime_type` is never one a consumer could execute.
 */
const INLINE_DATA_MIME: Readonly<Record<Exclude<SandboxMediaKind, 'file'>, ReadonlySet<string>>> = Object.freeze({
  image: new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']),
  video: new Set(['video/mp4', 'video/ogg', 'video/webm']),
  audio: new Set(['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm']),
});

/** A `data:` link of an allowed inline type for `kind`, in canonical form; null otherwise. */
function inlineDataUrl(kind: SandboxMediaKind, value: string): { mime: string; value: string } | null {
  if (kind === 'file') return null;
  const data = DATA_URL.exec(value);
  if (!data) return null;
  const mime = data[1]!.toLowerCase();
  if (data[2]!.toLowerCase() !== kind || !INLINE_DATA_MIME[kind].has(mime)) return null;
  return { mime, value: `data:${mime};base64,${data[3]!.replace(/\s+/gu, '')}` };
}

/**
 * Accepted media links: absolute `http(s)` URLs, and for image / video / audio a base64 `data:` URL
 * of the same media type and an inline-renderable subtype (what the composer's paste and URL dialog
 * already insert).
 */
export function isSandboxInboundMediaUrl(kind: SandboxMediaKind, value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (DATA_URL.test(trimmed)) return inlineDataUrl(kind, trimmed) !== null;
  return remoteMediaUrl(trimmed) !== null;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

/**
 * An absolute `http(s)` link in its serialized form (`URL.href`), or null. Control characters
 * (which the URL parser would silently drop, e.g. `java\tscript:`) and embedded credentials are
 * refused, so what is stored, shown and fetched is the same visible link.
 */
function remoteMediaUrl(value: string): string | null {
  if (CONTROL_CHARACTER.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Display name of a linked file: the last path segment, decoded. It is only a label, but plugins
 * may save attachments under `data.name`, so a decoded separator (`%2F`, `%5C`), a dot segment or a
 * control character drops the name instead of carrying a path into it.
 */
function fileNameOf(value: string): string | undefined {
  try {
    const last = new URL(value).pathname.split('/').filter(Boolean).at(-1);
    if (!last) return undefined;
    const name = decodeURIComponent(last).trim();
    if (!name || name === '.' || name === '..' || /[\\/]/u.test(name) || CONTROL_CHARACTER.test(name)) return undefined;
    return name.length > 255 ? undefined : name;
  } catch {
    return undefined;
  }
}

/**
 * The segment the composer buttons insert for a media link; the typed form builds the same one.
 * A `data:` URL (a pasted image) is inline media, so it is a `base64` ref: the Agent's inbound media
 * path refuses `data:` as a network URL and would otherwise never see the pasted image.
 */
/** What the store reports about an uploaded file (ADR 0064 D13.3); every field is optional. */
export interface SandboxInboundMediaMeta {
  readonly mime_type?: string;
  readonly size?: number;
  readonly file_name?: string;
}

function mediaMeta(meta: SandboxInboundMediaMeta | undefined): Record<string, unknown> {
  if (!meta) return {};
  return {
    ...(typeof meta.mime_type === 'string' && /^[a-z]+\/[a-z0-9.+-]+$/iu.test(meta.mime_type) ? { mime_type: meta.mime_type } : {}),
    ...(typeof meta.size === 'number' && Number.isSafeInteger(meta.size) && meta.size >= 0 ? { size: meta.size } : {}),
    ...(typeof meta.file_name === 'string' && meta.file_name && meta.file_name.length <= 255 && !/[\\/]/u.test(meta.file_name) && !CONTROL_CHARACTER.test(meta.file_name)
      ? { file_name: meta.file_name } : {}),
  };
}

export function sandboxInboundMediaSegment(kind: SandboxMediaKind, url: string, meta?: SandboxInboundMediaMeta): SandboxInboundSegment {
  const value = url.trim();
  const data = inlineDataUrl(kind, value);
  if (data) return { type: kind, data: { media: { kind: 'base64', value: data.value, mime_type: data.mime } } };
  // An accepted link is stored as `URL.href`; anything else keeps the picked value as before.
  const link = remoteMediaUrl(value) ?? value;
  const extra = mediaMeta(meta);
  if (kind === 'file') {
    const name = (extra.file_name as string | undefined) ?? fileNameOf(link);
    return { type: 'file', data: { media: { kind: 'url', value: link, ...extra }, ...(name ? { name } : {}) } };
  }
  return { type: kind, data: { media: { kind: 'url', value: link, ...extra } } };
}

export function sandboxInboundFaceSegment(id: number | string): SandboxInboundSegment {
  return { type: 'face', data: { id: Number(id) } };
}

export function sandboxInboundMentionSegment(name: string, id?: string): SandboxInboundSegment {
  const trimmed = name.trim();
  return { type: 'mention', data: { target: id?.trim() || trimmed, name: trimmed } };
}

export interface SandboxInboundTextParse {
  readonly segments: SandboxInboundSegment[];
  readonly issues: SandboxInboundSyntaxIssue[];
  /** Whether at least one token became a segment. */
  readonly expanded: boolean;
}

/** Splits one text value into text and the segments its typed tokens stand for. */
export function parseSandboxInboundText(text: string): SandboxInboundTextParse {
  const segments: SandboxInboundSegment[] = [];
  const issues: SandboxInboundSyntaxIssue[] = [];
  let pending = '';
  let expanded = false;
  const flush = () => {
    if (pending) segments.push({ type: 'text', data: { text: pending } });
    pending = '';
  };
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const [whole, mention, face, mediaKind, mediaValue] = match;
    pending += text.slice(last, match.index);
    last = match.index + whole.length;
    if (mention !== undefined) {
      if (!mention.trim()) { pending += whole; continue; }
      flush();
      segments.push(sandboxInboundMentionSegment(mention));
      expanded = true;
    } else if (face !== undefined) {
      flush();
      segments.push(sandboxInboundFaceSegment(face));
      expanded = true;
    } else {
      const kind = mediaKind as SandboxMediaKind;
      if (!isSandboxInboundMediaUrl(kind, mediaValue!)) {
        issues.push({ kind, token: whole, reason: 'invalid_url' });
        pending += whole;
        continue;
      }
      flush();
      segments.push(sandboxInboundMediaSegment(kind, mediaValue!));
      expanded = true;
    }
  }
  pending += text.slice(last);
  flush();
  return { segments, issues, expanded };
}

/**
 * Expands typed tokens inside every `text` segment; other segments (picked media, mentions, faces)
 * pass through unchanged. Adjacent text is not merged, so expansion never moves text across segments.
 */
export function expandSandboxInboundSyntax<T extends { readonly type: string; readonly data?: Record<string, unknown> }>(
  segments: readonly T[],
): { segments: (T | SandboxInboundSegment)[]; issues: SandboxInboundSyntaxIssue[]; expanded: boolean } {
  const next: (T | SandboxInboundSegment)[] = [];
  const issues: SandboxInboundSyntaxIssue[] = [];
  let expanded = false;
  for (const segment of segments) {
    const value = segment.type === 'text' ? segment.data?.text : undefined;
    if (typeof value !== 'string' || !value.includes('[')) {
      next.push(segment);
      continue;
    }
    const parsed = parseSandboxInboundText(value);
    issues.push(...parsed.issues);
    if (!parsed.expanded) {
      next.push(segment);
      continue;
    }
    expanded = true;
    next.push(...parsed.segments);
  }
  return { segments: expanded ? next : [...segments], issues, expanded };
}

/**
 * Plain-text view of typed text: mentions become `@name` via `mention`, every accepted media / face
 * token is removed (a picked image contributes no text either), rejected tokens stay as typed.
 */
export function stripSandboxInboundSyntax(
  text: string,
  mention: (name: string) => string,
): { text: string; removed: boolean } {
  let removed = false;
  const plain = text.replace(TOKEN, (whole, name?: string, face?: string, kind?: string, value?: string) => {
    if (name !== undefined) {
      if (!name.trim()) return whole;
      const replacement = mention(name);
      if (!replacement) removed = true;
      return replacement;
    }
    if (face !== undefined) { removed = true; return ''; }
    if (!isSandboxInboundMediaUrl(kind as SandboxMediaKind, value!)) return whole;
    removed = true;
    return '';
  });
  return { text: plain, removed };
}
