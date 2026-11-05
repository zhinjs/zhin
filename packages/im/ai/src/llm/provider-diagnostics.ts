/** Known replay-only protocol state. Ordinary options, tool arguments and call ids remain useful diagnostics. */
const opaqueOptions: Readonly<Record<string, ReadonlySet<string>>> = {
  anthropic: new Set(['signature', 'redactedData']), google: new Set(['thoughtSignature']), vertex: new Set(['thoughtSignature']),
  openai: new Set(['itemId', 'reasoningEncryptedContent']),
};
export const PROVIDER_STATE_OMITTED = '[provider state omitted]';

/** Pure diagnostic copy. The original owner-bound history and actual wire are never modified. */
export function projectProviderDiagnostics(input: Record<string, unknown>): Record<string, unknown>;
export function projectProviderDiagnostics(input: readonly unknown[]): unknown[];
export function projectProviderDiagnostics(input: unknown): unknown;
export function projectProviderDiagnostics(input: unknown): unknown {
  const projectedCopies = new WeakMap<object, unknown>(), payloadCopies = new WeakMap<object, unknown>();
  const copy = (value: unknown, path: readonly string[], projectState = true): unknown => {
    const copies = projectState ? projectedCopies : payloadCopies;
    if (!value || typeof value !== 'object' || value instanceof URL || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value;
    if (copies.has(value)) return copies.get(value);
    if (Array.isArray(value)) {
      const result: unknown[] = []; copies.set(value, result);
      for (const item of value) result.push(copy(item, path, projectState));
      return result;
    }
    const record = value as Record<string, unknown>, result: Record<string, unknown> = {};
    copies.set(value, result);
    const namespace = path.at(-1), container = path.at(-2);
    for (const [key, item] of Object.entries(record)) {
      const privateOption = (container === 'providerOptions' || container === 'providerMetadata') && namespace && opaqueOptions[namespace]?.has(key);
      const privateNative = record.type === 'reasoning' && key === 'encrypted_content'
        || record.type === 'thinking' && key === 'signature' || record.type === 'redacted_thinking' && key === 'data'
        || key === 'thoughtSignature' && (typeof record.text === 'string' || record.functionCall !== undefined || record.thought === true);
      const toolPayload = (record.type === 'toolCall' || record.type === 'tool-call' || record.type === 'tool_use') && (key === 'arguments' || key === 'input')
        || path.at(-1) === 'functionCall' && key === 'args';
      result[key] = projectState && (privateOption || privateNative || key === 'providerStateScope' && record.role === 'assistant')
        ? PROVIDER_STATE_OMITTED : copy(item, [...path, key], projectState && !toolPayload);
    }
    return result;
  };
  return copy(input, []);
}
