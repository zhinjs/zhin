/**
 * Send-chain bypass rules shared by `scripts/check-im-send-bypass.mjs` and kept in lockstep with
 * the self-change trial (`packages/im/agent/src/self-change/trial.ts`, `SELF_CHANGE_SEND_BYPASS_PATTERNS`;
 * `scripts/check-im-send-bypass.test.ts` asserts the two lists are identical and that both sides agree
 * on every sample).
 *
 * The only outbound path for plugin code is `Message.$reply` / `$sendTo` or the Runtime outbound port
 * (`outboundMessageToken` / `outboundHostToken`) → OutboundRenderer → outbound middleware → Endpoint.
 * These patterns catch plugin code that reaches past it to the Endpoint, its transport or the platform
 * client. Adapter packages implement the Endpoint itself (`src/`, `adapters/`), so those directories are
 * never scanned with these rules.
 *
 * Object names:
 * - `bot`, `endpoint`, `lease`, `$client`: IM objects; every send-family method counts.
 * - `client`, `transport`, `sdk`: also the names of AWS SDK clients, WebSockets, MCP / A2A transports.
 *   Only IM-specific methods count on them (`send*Message`, `send*Msg`, `sendPhoto` / `sendFile` / …,
 *   `postMessage`); a bare `.send(` (`client.send(new PutObjectCommand())`, `transport.send(frame)`) is
 *   not an IM send.
 *
 * Covered spellings: `obj.send(`, `obj?.send(`, `obj!.send(`, `(obj as T).send(`, `obj.send?.(`,
 * `obj['send'](`, line breaks anywhere in a chain (rules run on the whole file, see `findSendBypasses`).
 *
 * Limits (by design): this is a lint-level guard rail. Destructuring (`const { send } = endpoint`),
 * aliasing (`const e = endpoint; e.send()`), `.bind` / `.call` / `Reflect.apply`, computed member names
 * built at run time and any other indirection are out of reach of a regex. The real constraint is that
 * the runtime never hands an Endpoint to plugin code (plugins only get the outbound port), plus the
 * owner's manual approval of every self-change draft.
 */
import { stripComments } from './strip-comments.mjs';

export { stripComments };

/** Send-family methods on an IM object (`bot` / `endpoint` / `lease` / `$client`). */
const IM_OBJECT_METHODS = String.raw`send|sendPayload|send\w*(?:Message|Msg)\w*|send(?:Text|Image|Photo|File|Document|Voice|Audio|Video|Sticker|Poll|Card|Markdown)\w*|postMessage`;
/** IM-specific methods on a generic client / transport / SDK object (no bare `send`). */
const IM_SPECIFIC_METHODS = String.raw`send\w*(?:Message|Msg)\w*|send(?:Text|Image|Photo|File|Document|Voice|Audio|Video|Sticker|Poll|Card|Markdown)\w*|postMessage`;
/** Between the object and the member access: `!`, ` as T`, closing parentheses. */
const OBJECT_TAIL = String.raw`(?:\s*!)?(?:\s+as\s+[\w$.]+(?:<[^<>()\n]*>)?(?:\[\])?)?(?:\s*\))*`;
/** `.m(`, `?.m(`, `.m?.(`, `['m'](`, `?.['m'](`. */
const access = (methods) => String.raw`\s*(?:(?:\?\.|\.)\s*(?:${methods})|(?:\?\.)?\s*\[\s*['"\x60](?:${methods})['"\x60]\s*\])\s*(?:\?\.\s*)?\(`;

/** @type {ReadonlyArray<Readonly<{ id: string; source: string; message: string }>>} */
export const SEND_BYPASS_PATTERNS = Object.freeze([
  Object.freeze({
    id: 'endpoint_send_message',
    source: String.raw`(?:\$sendMessage|\[\s*['"\x60]\$sendMessage['"\x60]\s*\])\s*(?:\?\.\s*)?\(`,
    message: 'calls the removed endpoint $sendMessage() directly',
  }),
  Object.freeze({
    id: 'endpoint_send',
    source: String.raw`(?<![\w$])(?:bot|endpoint|lease|\$client)` + OBJECT_TAIL + access(IM_OBJECT_METHODS),
    // Message-sending method names only: platform actions such as sendLike / sendPoke are not sends.
    message: 'calls an Endpoint / lease / bot send method directly',
  }),
  Object.freeze({
    id: 'platform_client_send',
    source: String.raw`(?<![\w$])(?:client|transport|sdk)` + OBJECT_TAIL + access(IM_SPECIFIC_METHODS),
    message: 'calls an IM message-send method on a platform client / transport / SDK directly',
  }),
  Object.freeze({
    id: 'adapter_index_send',
    source: String.raw`(?<![\w$])(?:adapterIndex|adapters)` + OBJECT_TAIL + access(String.raw`send(?:Target)?`),
    message: 'sends through the AdapterIndex directly',
  }),
]);

/** Fresh global RegExp objects (use with `matchAll`). */
export function sendBypassRegexes() {
  return SEND_BYPASS_PATTERNS.map((rule) => ({ ...rule, re: new RegExp(rule.source, 'gu') }));
}

/**
 * Matches of the send bypass rules over the whole file (so a call chain broken across lines is still
 * seen), after comments are blanked with the shared length-preserving stripper; each hit is reported on
 * the line where the match starts.
 * @param {string} source
 * @returns {Array<{ id: string; line: number; text: string }>}
 */
export function findSendBypasses(source) {
  const code = stripComments(source);
  const lineStarts = [0];
  for (let index = source.indexOf('\n'); index >= 0; index = source.indexOf('\n', index + 1)) lineStarts.push(index + 1);
  const lines = source.split('\n');
  const lineOf = (offset) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
  /** @type {Array<{ id: string; line: number; text: string; offset: number }>} */
  const hits = [];
  for (const rule of sendBypassRegexes()) {
    for (const match of code.matchAll(rule.re)) {
      const line = lineOf(match.index);
      hits.push({ id: rule.id, line, text: lines[line - 1].replace(/\r$/u, '').trim(), offset: match.index });
    }
  }
  return hits.sort((a, b) => a.offset - b.offset).map(({ offset: _offset, ...hit }) => hit);
}
