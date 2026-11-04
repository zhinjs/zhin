import { parsePartialJson as sdkParsePartialJson } from 'ai';
import type { ProtocolJsonValue } from './types/model.js';

/** The SDK parser result, without exposing its unrelated browser/Provider type surface. */
export interface PartialJsonResult {
  value: ProtocolJsonValue | undefined;
  state: 'undefined-input' | 'successful-parse' | 'repaired-parse' | 'failed-parse';
}

/** Preserve the SDK parser's repair and error behavior; only the public type boundary is neutral. */
export function parsePartialJson(jsonText: string | undefined): Promise<PartialJsonResult> {
  return sdkParsePartialJson(jsonText);
}
