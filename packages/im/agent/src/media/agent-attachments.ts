/**
 * #1250 subagent-image-result-passthrough: media a sub-agent's tools produced (generated
 * images, audio, files) travels back to the asking agent as structured attachments, not as
 * URLs the sub-agent may or may not repeat in its reply text.
 *
 * Two hops, both framework-owned:
 * 1. The actor turn runner stores the sub-agent turn's media under the answered mail id
 *    ({@link recordActorAttachments}); the `ask` / `follow_up` tool takes it with the reply
 *    ({@link takeActorAttachments}).
 * 2. The tool registers the media and adds an opaque `zhin-attachment:<id>` reference to its
 *    result text ({@link renderAttachmentNote}); the asking turn's tool loop resolves those
 *    references of collaboration tools into the tool call record
 *    ({@link resolveAttachmentRefs}), and the reply merges them like any tool media, so they
 *    are sent through the normal outbound chain.
 *
 * References are random and resolve once: a model cannot conjure media by writing one.
 *
 * Only **tool-produced** media is handed back ({@link collectTurnAttachments}): media the
 * sub-agent merely wrote into its reply text (`![](/etc/passwd)`, `[file:x](/path)`) is never an
 * attachment, because it would be sent with the asker's (wider) outbound media authority. Each
 * tool attachment is additionally authorized with the sub-agent's own, narrowed authority
 * ({@link authorizeActorAttachments}) before it is recorded.
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AgentOutputElement } from '../outbound/agent-output.js';
import type { ToolCallRecord } from '../core/tool-calls-user-format.js';
import { extractMediaElementsFromToolCalls } from './media-tool-bridge.js';
import { authorizeOutboundMediaPath, type OutboundMediaAuthority } from './media-normalize.js';

export type AgentAttachment = Extract<AgentOutputElement, { type: 'image' | 'audio' | 'video' | 'file' }>;

/** Attachments kept per answered mail and per pending reference. */
export const MAX_AGENT_ATTACHMENTS = 8;
const MAX_PENDING_MAILS = 64;
const MAX_PENDING_REFS = 256;
const REF_PATTERN = /zhin-attachment:([0-9a-f-]{36})/gu;

const byHarness = new WeakMap<object, Map<string, readonly AgentAttachment[]>>();
const pendingRefs = new Map<string, AgentAttachment>();

function isAttachment(element: AgentOutputElement): element is AgentAttachment {
  return element.type === 'image' || element.type === 'audio' || element.type === 'video' || element.type === 'file';
}

function attachmentKey(element: AgentAttachment): string {
  return `${element.type}:${element.url}`;
}

/**
 * Media one finished agent turn's **tools** produced. The turn's parsed reply output is not a
 * source: links the model wrote into its text are model-authored, not tool results.
 */
export function collectTurnAttachments(
  toolCalls: readonly ToolCallRecord[] | undefined,
): AgentAttachment[] {
  const seen = new Set<string>();
  const out: AgentAttachment[] = [];
  for (const element of extractMediaElementsFromToolCalls([...(toolCalls ?? [])]).filter(isAttachment)) {
    const key = attachmentKey(element);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(element);
    if (out.length >= MAX_AGENT_ATTACHMENTS) break;
  }
  return out;
}

const SCHEME = /^([a-z][a-z0-9+.-]*):/iu;

/**
 * Keeps the attachments the sub-agent itself may hand out, judged with its own (narrowed)
 * authority, not the asker's:
 *  - inline media (`data:` / `base64://`, or a `base64` payload) passes;
 *  - `http(s)` URLs pass — they carry no host data, and the asker's outbound chain fetches them
 *    under its own network authority;
 *  - a local path (or `file:` URL) passes only when the sub-agent's file authority admits it
 *    (the same decision as `read_file`); it is replaced by the canonical path;
 *  - anything else is dropped.
 */
export async function authorizeActorAttachments(
  attachments: readonly AgentAttachment[],
  authority: OutboundMediaAuthority,
): Promise<AgentAttachment[]> {
  const kept: AgentAttachment[] = [];
  for (const attachment of attachments) {
    const url = attachment.url;
    if (('base64' in attachment && attachment.base64) || /^(?:data:|base64:\/\/)/iu.test(url)) {
      kept.push(attachment);
      continue;
    }
    const scheme = SCHEME.exec(url)?.[1]?.toLowerCase();
    // A one-letter "scheme" is a Windows drive letter, i.e. a local path.
    if (scheme === 'http' || scheme === 'https') {
      kept.push(attachment);
      continue;
    }
    let localPath: string | undefined;
    if (scheme === 'file') {
      try { localPath = fileURLToPath(url); } catch { localPath = undefined; }
    } else if (!scheme || scheme.length === 1) {
      localPath = url;
    }
    if (!localPath) continue;
    const canonical = await authorizeOutboundMediaPath(localPath, authority).catch(() => null);
    if (canonical) kept.push({ ...attachment, url: canonical } as AgentAttachment);
  }
  return kept;
}

/** Stores a sub-agent turn's media under the mails it answered. */
export function recordActorAttachments(harness: object, mailIds: readonly string[], attachments: readonly AgentAttachment[]): void {
  if (attachments.length === 0 || mailIds.length === 0) return;
  let pending = byHarness.get(harness);
  if (!pending) {
    pending = new Map();
    byHarness.set(harness, pending);
  }
  const frozen = Object.freeze(attachments.slice(0, MAX_AGENT_ATTACHMENTS).map(item => Object.freeze({ ...item }) as AgentAttachment));
  for (const id of mailIds) {
    pending.delete(id);
    pending.set(id, frozen);
  }
  while (pending.size > MAX_PENDING_MAILS) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
}

/** Takes (once) the media recorded for an answered mail. */
export function takeActorAttachments(harness: object, mailId: string | undefined): readonly AgentAttachment[] {
  if (!mailId) return [];
  const pending = byHarness.get(harness);
  const found = pending?.get(mailId);
  if (!found) return [];
  pending!.delete(mailId);
  return found;
}

function register(attachment: AgentAttachment): string {
  const id = randomUUID();
  pendingRefs.set(id, attachment);
  while (pendingRefs.size > MAX_PENDING_REFS) {
    const oldest = pendingRefs.keys().next().value;
    if (oldest === undefined) break;
    pendingRefs.delete(oldest);
  }
  return `zhin-attachment:${id}`;
}

function describe(attachment: AgentAttachment): string {
  if (attachment.type === 'file') return `file ${attachment.name}`;
  return attachment.type;
}

/**
 * Model-facing note for attachments returned with an agent reply. Each line carries an
 * opaque reference the framework resolves; the media is sent with the final reply.
 */
export function renderAttachmentNote(agent: string, attachments: readonly AgentAttachment[]): string {
  if (attachments.length === 0) return '';
  const lines = attachments.map((attachment, index) => `- #${index + 1} ${describe(attachment)} (${register(attachment)})`);
  return [
    `Attachments from agent ${agent} (${attachments.length}): the framework sends them with your reply. `
      + 'Do not ask again or regenerate them, and do not copy their references into your reply.',
    ...lines,
  ].join('\n');
}

/** Resolves (once) the attachment references in a collaboration tool's result text. */
export function resolveAttachmentRefs(text: unknown): AgentAttachment[] {
  if (typeof text !== 'string' || !text.includes('zhin-attachment:')) return [];
  const out: AgentAttachment[] = [];
  for (const match of text.matchAll(REF_PATTERN)) {
    const id = match[1]!;
    const attachment = pendingRefs.get(id);
    if (!attachment) continue;
    pendingRefs.delete(id);
    out.push(attachment);
  }
  return out;
}
