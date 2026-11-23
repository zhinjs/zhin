/**
 * #1250 sandbox-transcript-shared-bind-code: the Sandbox conversation is shared by every Console user
 * who opens it (its echo reaches every subscribed page, its records are read back by all of them), so
 * a chat-identity bind message (`绑定 <码>`, `/bind <code>`, with or without a command prefix) is hidden
 * here, before anything echoes, logs, records or routes it: it becomes `绑定 ***` by its shape alone
 * (`redactChatIdentityBindText`), whether or not such a code is open (an expired code is shown no more
 * than a live one). An argument with the shape of a code (`绑定 23456789`) is rewritten too (README).
 *
 * Nothing is lost by it: a Sandbox (`runtime.sandbox`, the page picks the sender id) never accepts bind
 * codes (ADR 0060 §2.4). With an empty command prefix, or sent with the prefix, `绑定 ***` still gets
 * the Sandbox refusal from the `bind` command (without a configured prefix it is ordinary chat); the
 * sender's own page replaces its typed bubble with the hidden echo.
 */
import { redactChatIdentityBindText } from 'zhin.js';
import type { MessageElement, SandboxParsedMessage } from './protocol.js';

/** The message (and its raw frame) with a bind code hidden; the same objects when it carries none. */
export function redactSandboxBindCode(message: SandboxParsedMessage, raw: string): Readonly<{ message: SandboxParsedMessage; raw: string; redacted: boolean }> {
  const text = redactBindText(message.text);
  if (text === message.text) return { message, raw, redacted: false };
  // The text was the bind message: its text segments become the one hidden text, other segments stay.
  // A frame without text segments (its text came from an action payload) gets none added: the page
  // tells an action-only frame by `content.every(type === 'action')`, so only `text` changes.
  const content: MessageElement[] = [];
  let placed = false;
  for (const segment of message.content) {
    if (segment.type !== 'text') { content.push(segment); continue; }
    if (!placed) content.push({ type: 'text', data: { text } });
    placed = true;
  }
  return { message: { ...message, content, text }, raw: redactRawFrame(raw, content, text), redacted: true };
}

/**
 * The bind shape of `text` (`redactChatIdentityBindText`), also after one leading word: the account's
 * command prefix may be a word (`zhin 绑定 <码>`), and hiding a little more is safer here.
 */
function redactBindText(text: string): string {
  const direct = redactChatIdentityBindText(text);
  if (direct !== text) return direct;
  const lead = /^\S+(?=\s)/u.exec(text.trim())?.[0];
  return lead ? redactChatIdentityBindText(text, lead) : text;
}

/** The raw frame handed to platform listeners, rebuilt without the code. */
function redactRawFrame(raw: string, content: readonly MessageElement[], text: string): string {
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return text; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return text;
  const { text: _text, content: _content, ...rest } = payload as Record<string, unknown>;
  return JSON.stringify({ ...rest, content });
}
