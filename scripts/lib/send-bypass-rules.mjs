/**
 * Send-chain bypass rules shared by `scripts/check-im-send-bypass.mjs` and kept in lockstep with
 * the self-change trial (`packages/im/agent/src/self-change/trial.ts`, `SELF_CHANGE_SEND_BYPASS_PATTERNS`;
 * `scripts/check-im-send-bypass.test.ts` asserts the two lists are identical).
 *
 * The only outbound path for plugin code is `Message.$reply` / `$sendTo` or the Runtime outbound port
 * (`outboundMessageToken` / `outboundHostToken`) → OutboundRenderer → outbound middleware → Endpoint.
 * These patterns catch plugin code that reaches past it to the Endpoint, its transport or the platform
 * client. Adapter packages implement the Endpoint itself (`src/`, `adapters/`), so those directories are
 * never scanned with these rules.
 */

/** @type {ReadonlyArray<Readonly<{ id: string; source: string; message: string }>>} */
export const SEND_BYPASS_PATTERNS = Object.freeze([
  Object.freeze({
    id: 'endpoint_send_message',
    source: String.raw`\$sendMessage\s*\(`,
    message: 'calls the removed endpoint $sendMessage() directly',
  }),
  Object.freeze({
    id: 'endpoint_send',
    source: String.raw`(?<![\w$])(?:bot|endpoint|lease|transport|client|\$client|sdk)\s*\??\.\s*(?:send|sendPayload|send\w*(?:Message|Msg)\w*|send(?:Text|Image|Photo|File|Document|Voice|Audio|Video|Sticker|Poll|Card|Markdown)\w*|postMessage)\s*\(`,
    // Message-sending method names only: platform actions such as sendLike / sendPoke are not sends.
    message: 'calls an Endpoint / transport / platform client send method directly',
  }),
  Object.freeze({
    id: 'adapter_index_send',
    source: String.raw`(?<![\w$])(?:adapterIndex|adapters)\s*\??\.\s*send(?:Target)?\s*\(`,
    message: 'sends through the AdapterIndex directly',
  }),
]);

/** Fresh RegExp objects (stateless `test()` — no `g` flag). */
export function sendBypassRegexes() {
  return SEND_BYPASS_PATTERNS.map((rule) => ({ ...rule, re: new RegExp(rule.source, 'u') }));
}

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/u;

/**
 * Line-level matches of the send bypass rules; comment lines are ignored.
 * @param {string} source
 * @returns {Array<{ id: string; line: number; text: string }>}
 */
export function findSendBypasses(source) {
  const rules = sendBypassRegexes();
  /** @type {Array<{ id: string; line: number; text: string }>} */
  const hits = [];
  source.split(/\r?\n/u).forEach((text, index) => {
    if (COMMENT_LINE.test(text)) return;
    for (const rule of rules) {
      if (rule.re.test(text)) hits.push({ id: rule.id, line: index + 1, text: text.trim() });
    }
  });
  return hits;
}
