/**
 * Secret-shaped text masking (#1250 b111), shared by every layer that writes reasons, errors or
 * payload excerpts to logs and display surfaces. It lives here, at the bottom of the dependency
 * graph, so provider-layer packages (`@zhin.js/adapter`, which may not import `@zhin.js/kernel`)
 * and the kernel (which re-exports {@link redactSecretText}) apply the same rules.
 */

const REDACTED = '[redacted]';

/** Name fragments that mark an env variable, flag or header as carrying a secret. */
const SECRET_NAME = '(?:token|secret|password|passwd|pwd|api[-_]?key|private[-_]?key|access[-_]?key|credentials?|cookie|session[-_]?id)';

const SECRET_VALUE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // PEM blocks (`-----BEGIN PRIVATE KEY----- … -----END PRIVATE KEY-----`), on one line or many,
  // first, so the base64 body is never matched piecemeal by the rules below. A private-key block
  // whose END is missing (the text was cut) is masked to the end of the text.
  [/-----BEGIN ([A-Z0-9 ]{1,64})-----[\s\S]*?-----END \1-----/g, `-----BEGIN $1----- ${REDACTED} -----END $1-----`],
  [/-----BEGIN [A-Z0-9 ]{0,64}PRIVATE KEY-----(?![\s\S]*-----END )[\s\S]*/g, REDACTED],
  // `Authorization: token abc`, `Proxy-Authorization: Basic …` — the whole credential.
  [/\b((?:proxy-)?authorization)\s*([:=])\s*(?:(?:bearer|basic|token|digest)\s+)?[^\s"',;]{4,}/gi, `$1$2 ${REDACTED}`],
  // `X-Api-Key: …`, `X-Auth-Token: …`
  [new RegExp(`\\b(x-[a-z0-9-]*(?:${SECRET_NAME}|auth)[a-z0-9-]*)\\s*:\\s*[^\\s"',;]+`, 'gi'), `$1: ${REDACTED}`],
  // `FOO_TOKEN=…`, `export API_KEY="…"`, `DB_PASSWORD: …` (env / config assignments).
  // Quoted values keep their quotes: `apiKey = "[redacted]"`.
  [new RegExp(`\\b([A-Za-z0-9_]*${SECRET_NAME}[A-Za-z0-9_]*\\s*=\\s*)(["'])(?:(?!\\2).)*\\2`, 'gi'), `$1$2${REDACTED}$2`],
  [new RegExp(`\\b([A-Za-z0-9_]*${SECRET_NAME}[A-Za-z0-9_]*\\s*=\\s*)(?!["'\\[])[^\\s;&|"']+`, 'gi'), `$1${REDACTED}`],
  // `--password=…`, `--token …`, `--api-key …`
  [new RegExp(`(--?[A-Za-z0-9-]*${SECRET_NAME}[A-Za-z0-9-]*(?:=|\\s+))(["'])(?:(?!\\2).)*\\2`, 'gi'), `$1$2${REDACTED}$2`],
  [new RegExp(`(--?[A-Za-z0-9-]*${SECRET_NAME}[A-Za-z0-9-]*(?:=|\\s+))(?!["'\\[])[^\\s"']+`, 'gi'), `$1${REDACTED}`],
  // `https://user:pass@host` — keep the user, hide the password.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s/@]+@/gi, `$1:${REDACTED}@`],
  // JWT (`eyJ…`), AWS access key ids, Google API keys.
  [/\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2}/g, REDACTED],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, REDACTED],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\b(?:ghp|gho|ghs|ghu|ghr|github_pat|xox[abpr])_[A-Za-z0-9_]{8,}/g, REDACTED],
  [/\b(?:SESSDATA|bili_jct|cookie)\s*[=:]\s*[^;\s]+/gi, REDACTED],
  // JSON fields: `"token":"…"`, `"api_key": "…"` (#1250 batch 26: tool outputs reach logs).
  [new RegExp(`("[A-Za-z0-9_-]*${SECRET_NAME}[A-Za-z0-9_-]*"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, 'gi'), `$1"${REDACTED}"`],
  // YAML / prose fields: `api_key: …`, `password: '…'`; a bare number (`max_tokens: 100`) is not a secret.
  [new RegExp(`\\b([A-Za-z0-9_]*${SECRET_NAME}[A-Za-z0-9_]*\\s*:\\s*)(["'])(?:(?!\\2).)+\\2`, 'gi'), `$1$2${REDACTED}$2`],
  [new RegExp(`\\b([A-Za-z0-9_]*${SECRET_NAME}[A-Za-z0-9_]*\\s*:\\s*)(?![\\d.]+(?![^\\s,;}\\]]))(?!["'\\[{]|\\[redacted\\])[^\\s,;"'}\\]]+`, 'gi'), `$1${REDACTED}`],
  // URL query keys: `?key=…`, `&key=…`.
  [/([?&]key=)[^&\s#"']+/gi, `$1${REDACTED}`],
  // Telegram Bot API paths: `/bot<id>:<token>/`.
  [/\/bot(\d+):[A-Za-z0-9_-]{20,}/g, `/bot$1:${REDACTED}`],
];

/** Masks token-shaped text (bearer / API keys / cookies / PEM blocks) without truncating. */
export function redactSecretText(value: string): string {
  let text = value;
  for (const [pattern, replacement] of SECRET_VALUE_PATTERNS) text = text.replace(pattern, replacement);
  return text;
}
