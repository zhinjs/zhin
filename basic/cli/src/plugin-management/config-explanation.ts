import { isDeepStrictEqual } from 'node:util';
import { parsePluginConfigSchema } from '@zhin.js/runtime';
import type { ConsoleConfigExplanation, ConsoleConfigFieldEvidence } from '@zhin.js/console-protocol';

type Projection = Pick<ConsoleConfigExplanation, 'projection' | 'reason' | 'fields'>;
type Schema = Readonly<Record<string, unknown>>;
type Field = { path: readonly string[]; secret: boolean };
const complexKeywords = ['$ref', '$dynamicRef', 'anyOf', 'oneOf', 'allOf', 'not', 'if', 'then', 'else', 'dependentSchemas', 'dependentRequired', 'patternProperties', 'prefixItems', 'unevaluatedProperties'];
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** Read-only metadata projection. Actual values never leave this function. */
export function explainConfigFields(schema: Schema, input: unknown, current: unknown, committedInput: unknown): Projection {
  const unsupported = (reason: NonNullable<Projection['reason']>): Projection => ({ projection: 'unsupported', reason, fields: [] });
  const fields: Field[] = [];
  let issue: Projection['reason'];
  const visit = (node: unknown, path: readonly string[], inheritedSecret: boolean): void => {
    if (issue) return;
    if (!record(node) || complexKeywords.some(key => Object.hasOwn(node, key))
      || (node.additionalProperties !== undefined && node.additionalProperties !== false)) { issue = 'complex-schema'; return; }
    if (path.length > 8 || path.some(key => !key || key.length > 128 || forbiddenKeys.has(key))) { issue = 'bound-exceeded'; return; }
    const metadata = record(node['x-zhin-config']) ? node['x-zhin-config'] : {};
    const secret = inheritedSecret || node.writeOnly === true || metadata.secret === true || metadata.hidden === true || metadata.component === 'password';
    if (node.type === 'object') {
      if (node.properties !== undefined && !record(node.properties)) { issue = 'complex-schema'; return; }
      for (const [key, child] of Object.entries(node.properties ?? {})) visit(child, [...path, key], secret);
      return;
    }
    if (!['string', 'number', 'integer', 'boolean', 'null'].includes(String(node.type)) || Array.isArray(node.type)) { issue = 'complex-schema'; return; }
    if (path.length === 0 || fields.length >= 128) { issue = 'bound-exceeded'; return; }
    fields.push({ path: Object.freeze([...path]), secret });
  };
  visit(schema, [], false);
  if (issue) return unsupported(issue);
  let candidate: ReturnType<typeof parsePluginConfigSchema>;
  try { candidate = parsePluginConfigSchema(schema, input); }
  catch { return unsupported('candidate-invalid'); }
  if (candidate.errors.length) return unsupported('candidate-invalid');
  const metadata: ConsoleConfigFieldEvidence[] = fields.map(field => {
    const raw = at(input, field.path), next = at(candidate.value, field.path), applied = at(current, field.path), beforeExpansion = at(committedInput, field.path);
    const candidateOrigin = raw.present ? 'file' : next.present ? 'schema-default' : 'unset';
    const redacted = field.secret || [raw, next, beforeExpansion].some(item => typeof item.value === 'string' && item.value.includes('${'));
    // A schema scalar unexpectedly represented by an object or missing pre-expansion
    // evidence has no proven standard comparison. Never serialize that value to explain why.
    const unknown = [next, applied].some(item => item.value !== null && typeof item.value === 'object')
      || (applied.present && !beforeExpansion.present);
    const generationMatch = redacted ? 'redacted' : unknown ? 'unknown'
      : next.present === applied.present && isDeepStrictEqual(next.value, applied.value) ? 'equal' : 'different';
    return Object.freeze({ path: field.path, candidateOrigin, generationMatch, generationOrigin: 'unknown' });
  });
  if (Buffer.byteLength(JSON.stringify(metadata), 'utf8') > 16 * 1024) return unsupported('bound-exceeded');
  return Object.freeze({ projection: 'supported', fields: Object.freeze(metadata) });
}
function at(value: unknown, path: readonly string[]): { present: boolean; value?: unknown } {
  for (const key of path) {
    if (!record(value) || !Object.hasOwn(value, key)) return { present: false };
    value = value[key];
  }
  return { present: true, value };
}
