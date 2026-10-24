/**
 * Provider-safe tool names on the wire.
 *
 * Gemini rejects function declarations whose name does not match
 * `^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$` (HTTP 400 "Invalid function name"), but
 * zhin tool names come from plugin instance keys and skill ids, e.g.
 * `60s__skill__60s-life__weather`. The codec maps internal names to valid wire
 * names for the request and maps model tool calls back, so execution, policy and
 * history keep the real names. Valid names are sent unchanged.
 */

/** Gemini / Vertex function declaration name rule. */
export const GEMINI_TOOL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/;

const GEMINI_TOOL_NAME_MAX = 128;

export interface ToolNameCodec {
  /** Internal tool name → name sent to the provider. */
  toWire(name: string): string;
  /** Name returned by the provider → internal tool name (unknown names pass through). */
  fromWire(name: string): string;
}

const IDENTITY_CODEC: ToolNameCodec = {
  toWire: (name) => name,
  fromWire: (name) => name,
};

/** SDKs whose function-name rule is stricter than zhin's tool names. */
export function requiresToolNameSanitizing(sdk: string | undefined): boolean {
  return sdk === 'google';
}

export function isGeminiSafeToolName(name: string): boolean {
  return GEMINI_TOOL_NAME_PATTERN.test(name);
}

/** FNV-1a 32-bit, hex — short deterministic suffix for truncated or colliding names. */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function withSuffix(base: string, suffix: string): string {
  return `${base.slice(0, GEMINI_TOOL_NAME_MAX - suffix.length - 1)}_${suffix}`;
}

/** Deterministic Gemini-safe form of a tool name (may collide; the codec resolves that). */
export function sanitizeGeminiToolName(name: string): string {
  if (isGeminiSafeToolName(name)) return name;
  let out = name.replace(/[^A-Za-z0-9_.:-]/g, '_');
  if (!/^[A-Za-z_]/.test(out)) out = `_${out}`;
  if (out.length > GEMINI_TOOL_NAME_MAX) out = withSuffix(out, shortHash(name));
  return out;
}

/**
 * Build a codec for one request. Pass every tool name declared in the request;
 * names that only appear in history are assigned lazily through `toWire`.
 */
export function createToolNameCodec(names: Iterable<string>, sdk: string | undefined): ToolNameCodec {
  if (!requiresToolNameSanitizing(sdk)) return IDENTITY_CODEC;
  const toWire = new Map<string, string>();
  const fromWire = new Map<string, string>();

  const bind = (name: string, wire: string): string => {
    toWire.set(name, wire);
    fromWire.set(wire, name);
    return wire;
  };

  const assign = (name: string): string => {
    const existing = toWire.get(name);
    if (existing !== undefined) return existing;
    const base = sanitizeGeminiToolName(name);
    if (!fromWire.has(base)) return bind(name, base);
    let suffix = shortHash(name);
    let candidate = withSuffix(base, suffix);
    for (let i = 1; fromWire.has(candidate); i++) {
      suffix = `${shortHash(name)}${i}`;
      candidate = withSuffix(base, suffix);
    }
    return bind(name, candidate);
  };

  const unique = [...new Set(names)].sort();
  // Already-valid names keep their exact spelling, so sanitized names never take them.
  for (const name of unique) if (isGeminiSafeToolName(name)) bind(name, name);
  for (const name of unique) assign(name);

  return {
    toWire: assign,
    fromWire: (wire) => fromWire.get(wire) ?? wire,
  };
}
