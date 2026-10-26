import type {
  CommandDefinition, CommandParams, CommandOptions, CommandParamSchema,
  CommandParameterValue, CommandSegment, CommandSession,
} from './definition.js';
import type { Locale } from '@zhin.js/plugin-runtime';
import { commandDescription, commandMessages } from './messages.js';

export type CommandValidationIssueCode = 'expectedType' | 'expectedArray' | 'minimum' | 'maximum'
  | 'choices' | 'invalidFormat' | 'invalidValue' | 'unknownOption' | 'duplicateOption'
  | 'defaultUndefined' | 'parameterUndefined' | 'missingOption' | 'unexpectedArguments'
  | 'invalidParameter' | 'custom';

export interface CommandValidationIssue {
  readonly field: string;
  readonly message: string;
  readonly code?: CommandValidationIssueCode;
  readonly parameters?: Readonly<Record<string, string | number>>;
}

/** Stable validation reason and values; never reverse-parse an English message. */
export function commandValidationIssue(
  code: Exclude<CommandValidationIssueCode, 'custom'>,
  field: string,
  locale: Locale,
  parameters: Readonly<Record<string, string | number>> = {},
): CommandValidationIssue {
  const values = Object.freeze({ field, ...parameters });
  return Object.freeze({ field, code, parameters: values, message: commandMessages(locale, code, values) });
}
export interface ParsedCommandArguments {
  readonly params: Readonly<Record<string, CommandParameterValue>>;
  readonly options: Readonly<Record<string, CommandParameterValue>>;
  readonly remaining: readonly Readonly<CommandSegment>[];
  readonly issues: readonly CommandValidationIssue[];
}
const scalarTypes = new Set(['string', 'word', 'text', 'number', 'integer', 'float', 'boolean']);

/** Validate the single declaration used by parsing, help and execution. */
export function validateArgumentSchemas(params?: CommandParams, options?: CommandOptions): void {
  let optional = false;
  let rest = false;
  for (const [name, schema] of Object.entries(params ?? {})) {
    validateSchema(name, schema);
    if (rest) throw new TypeError('Command rest parameter must be last');
    if (optional && !schema.optional && schema.default === undefined) {
      throw new TypeError(`Required Command parameter ${name} cannot follow an optional parameter`);
    }
    optional ||= schema.optional === true || schema.default !== undefined;
    rest = schema.rest === true;
  }
  if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options))) {
    throw new TypeError('Command options must be a record');
  }
  const aliases = new Set<string>();
  for (const [name, schema] of Object.entries(options ?? {})) {
    validateSchema(name, schema);
    if (!scalarTypes.has(schema.type) || schema.type === 'text') {
      throw new TypeError(`Command option ${name} requires a scalar type`);
    }
    if (name === 'help') throw new TypeError('Command option help is reserved');
    if (schema.alias !== undefined) {
      if (!/^[a-zA-Z]$/u.test(schema.alias) || schema.alias === 'h' || aliases.has(schema.alias)) {
        throw new TypeError(`Invalid or duplicate Command option alias ${schema.alias}`);
      }
      aliases.add(schema.alias);
    }
  }
}
function validateSchema(name: string, schema: CommandParamSchema): void {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/u.test(name)) throw new TypeError(`Invalid Command argument name ${name}`);
  if (!schema || typeof schema !== 'object') throw new TypeError(`Invalid Command argument ${name}`);
  if (schema.min !== undefined && !Number.isFinite(schema.min)
    || schema.max !== undefined && !Number.isFinite(schema.max)
    || schema.min !== undefined && schema.max !== undefined && schema.min > schema.max) {
    throw new TypeError(`Invalid Command argument bounds for ${name}`);
  }
  if (schema.pattern !== undefined && !(schema.pattern instanceof RegExp)) {
    throw new TypeError(`Command argument ${name}.pattern must be a RegExp`);
  }
  if (schema.validate !== undefined && typeof schema.validate !== 'function') {
    throw new TypeError(`Command argument ${name}.validate must be a function`);
  }
  if (schema.choices !== undefined && !Array.isArray(schema.choices)) {
    throw new TypeError(`Command argument ${name}.choices must be an array`);
  }
  if (schema.descriptionI18n !== undefined && (!schema.descriptionI18n || typeof schema.descriptionI18n !== 'object'
    || Array.isArray(schema.descriptionI18n)
    || Object.entries(schema.descriptionI18n).some(([locale, text]) => !['zh-CN', 'en'].includes(locale) || typeof text !== 'string'))) {
    throw new TypeError(`Command argument ${name}.descriptionI18n must map zh-CN/en to strings`);
  }
  if (schema.default !== undefined && !scalarTypes.has(schema.type)) throw new TypeError(`Structured Command argument ${name} cannot declare a default`);
  if (schema.default !== undefined && typeof schema.default !== 'function') {
    if (Array.isArray(schema.default) && !schema.rest) throw new TypeError(`Command argument ${name} requires rest: true for an array default`);
    const values = schema.rest ? schema.default : [schema.default];
    if (!Array.isArray(values) || values.some((value) => !valueMatches(schema, value))) {
      throw new TypeError(`Invalid Command argument default for ${name}`);
    }
    const defaultSchema = { ...schema, validate: undefined };
    const issue = validateValue(name, defaultSchema, schema.default, {});
    if (issue) throw new TypeError(`Invalid Command argument default for ${name}: ${issue.message}`);
  }
}

interface TextToken {
  readonly value: string;
  readonly quoted: boolean;
  readonly raw?: string;
  readonly before?: string;
  readonly first?: boolean;
  readonly after?: string;
  /** Original message segment, retained while options are removed. */
  readonly segment?: number;
}
type Token = TextToken | Readonly<CommandSegment>;
function isTextToken(value: Token | undefined): value is TextToken {
  return value !== undefined && 'value' in value;
}
function tokenize(segments: readonly Readonly<CommandSegment>[]): Token[] {
  return segments.flatMap<Token>((segment, segmentIndex) => {
    if (segment.type !== 'text' || typeof segment.data.text !== 'string') return [segment];
    const tokens: Token[] = [];
    const pattern = /(--?[a-zA-Z][a-zA-Z0-9_-]*=)(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')|"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/gu;
    let end = 0;
    for (const match of segment.data.text.matchAll(pattern)) {
      const value = match[1] !== undefined ? match[1] + (match[2] ?? match[3] ?? '') : match[4] ?? match[5] ?? match[6] ?? '';
      tokens.push({ value: value.replace(/\\(["'\\])/gu, '$1'), quoted: match[1] === undefined && match[6] === undefined, raw: match[0], before: segment.data.text.slice(end, match.index), first: tokens.length === 0, segment: segmentIndex });
      end = (match.index ?? 0) + match[0].length;
    }
    const last = tokens.at(-1);
    if (isTextToken(last)) tokens[tokens.length - 1] = { ...last, after: segment.data.text.slice(end) };
    return tokens;
  });
}
/** Reserved flags use the same quoted-token and option-terminator rules as arguments. */
export function requestsCommandHelp(segments: readonly Readonly<CommandSegment>[]): boolean {
  for (const token of tokenize(segments)) {
    if (!isTextToken(token) || token.quoted) continue;
    if (token.value === '--') return false;
    if (token.value === '--help') return true;
  }
  return false;
}
function segmentsFromTokens(tokens: readonly Token[]): readonly Readonly<CommandSegment>[] {
  const result: CommandSegment[] = [];
  let lastTextSegment: number | undefined;
  for (const token of tokens) {
    if (isTextToken(token)) {
      const last = result.at(-1);
      const text = (token.raw ?? token.value) + (token.after ?? '');
      if (last?.type === 'text' && lastTextSegment === token.segment) result[result.length - 1] = { type: 'text', data: { text: `${last.data.text}${token.before || ' '}${text}` } };
      else result.push({ type: 'text', data: { text: (token.first ? token.before ?? '' : '') + text } });
      lastTextSegment = token.segment;
    } else { result.push(token); lastTextSegment = undefined; }
  }
  return Object.freeze(result);
}
function convert(schema: CommandParamSchema, token: Token | undefined): CommandParameterValue | undefined {
  if (!token) return undefined;
  if (isTextToken(token)) {
    const text = token.value;
    if (schema.type === 'string' || schema.type === 'word' || schema.type === 'text') return text;
    if (schema.type === 'boolean') return text === 'true' ? true : text === 'false' ? false : undefined;
    if (schema.type === 'number' || schema.type === 'integer' || schema.type === 'float') {
      const value = Number(text);
      return text !== '' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isInteger(value))
        && (schema.type !== 'float' || text.includes('.')) ? value : undefined;
    }
    return undefined;
  }
  const type = typeof token.type === 'string' ? token.type : token.type.name;
  if (type !== schema.type && !(schema.type === 'mention' && type === 'at')) return undefined;
  const data = token.data;
  const value = schema.type === 'image' ? data.media ?? data.file ?? data.url ?? data.src
    : schema.type === 'mention' ? data.target ?? data.user_id ?? data.qq
    : schema.type === 'reply' ? data.message_id ?? data.reply_id ?? data.id
    : schema.type === 'forward' ? data.forward_id ?? data.res_id ?? data.message_id ?? data.id
    : schema.type === 'dice' || schema.type === 'rps' ? data.result : data.id;
  return value as CommandParameterValue | undefined;
}
function valueMatches(schema: CommandParamSchema, value: unknown): boolean {
  if (schema.type === 'number' || schema.type === 'integer' || schema.type === 'float' || schema.type === 'dice' || schema.type === 'rps') {
    return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isInteger(value));
  }
  if (schema.type === 'mention' || schema.type === 'face' || schema.type === 'reply' || schema.type === 'forward') return typeof value === 'string' || typeof value === 'number' && Number.isFinite(value);
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'image') return typeof value === 'string' || !!value && typeof value === 'object';
  return typeof value === 'string';
}
function validateValue(field: string, schema: CommandParamSchema, value: CommandParameterValue, session: CommandSession, locale: Locale = 'zh-CN'): CommandValidationIssue | undefined {
  if (schema.rest && !Array.isArray(value)) return commandValidationIssue('expectedArray', field, locale, { type: schema.type });
  const values = schema.rest ? (Array.isArray(value) ? value : [value]) : [value];
  for (const item of values) {
    if (!valueMatches(schema, item)) return commandValidationIssue('expectedType', field, locale, { type: schema.type });
    const size = typeof item === 'number' ? item : typeof item === 'string' ? item.length : undefined;
    if (schema.min !== undefined && (size === undefined || size < schema.min)) return commandValidationIssue('minimum', field, locale, { minimum: schema.min });
    if (schema.max !== undefined && (size === undefined || size > schema.max)) return commandValidationIssue('maximum', field, locale, { maximum: schema.max });
    if (schema.choices && !schema.choices.includes(item)) return commandValidationIssue('choices', field, locale, { choices: schema.choices.join(', ') });
    if (schema.pattern) {
      const pattern = new RegExp(schema.pattern.source, schema.pattern.flags.replace(/[gy]/gu, ''));
      if (typeof item !== 'string' || !pattern.test(item)) return commandValidationIssue('invalidFormat', field, locale);
    }
  }
  const result = schema.validate?.(value, session);
  return typeof result === 'string' ? Object.freeze({ field, code: 'custom', message: result })
    : result === false ? commandValidationIssue('invalidValue', field, locale) : undefined;
}

/** Parse arguments after a route match; the CommandIndex remains the only dispatcher. */
export function parseCommandArguments(
  definition: CommandDefinition,
  remaining: readonly Readonly<CommandSegment>[],
  initial: Readonly<Record<string, CommandParameterValue>>,
  session: CommandSession,
  locale: Locale = 'zh-CN',
): ParsedCommandArguments {
  const params: Record<string, CommandParameterValue> = { __proto__: null, ...initial };
  const options: Record<string, CommandParameterValue> = { __proto__: null };
  const issues: CommandValidationIssue[] = [];
  const tokens = tokenize(remaining);
  const positional: Token[] = [];
  const schemas: CommandOptions | undefined = definition.options ?? (definition.params === undefined ? undefined : {});
  const optionNames = new Map(Object.entries(schemas ?? {}).flatMap<[string, string]>(([name, schema]) => [[`--${name}`, name], ...(schema.alias ? [[`-${schema.alias}`, name] as [string, string]] : [])]));
  let terminated = false;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) continue;
    if (!isTextToken(token) || token.quoted || terminated || schemas === undefined) { positional.push(token); continue; }
    if (token.value === '--') { terminated = true; continue; }
    if (!/^--?[a-zA-Z]/u.test(token.value)) { positional.push(token); continue; }
    const [rawFlag, inline] = token.value.split(/=(.*)/u);
    const flag = rawFlag ?? token.value;
    const name = optionNames.get(flag);
    if (!name) { issues.push(commandValidationIssue('unknownOption', flag, locale)); continue; }
    const schema = schemas[name];
    if (!schema) continue;
    if (Object.hasOwn(options, name)) { issues.push(commandValidationIssue('duplicateOption', name, locale)); continue; }
    let value: CommandParameterValue | undefined;
    if (inline !== undefined) value = convert(schema, { value: inline, quoted: false });
    else if (schema.type === 'boolean') value = true;
    else {
      const next = tokens[index + 1];
      if (isTextToken(next) && !(!next.quoted && /^--?[a-zA-Z]/u.test(next.value))) { index++; value = convert(schema, next); }
    }
    if (value === undefined) issues.push(commandValidationIssue('expectedType', name, locale, { field: `--${name}`, type: schema.type }));
    else options[name] = value;
  }
  for (const [name, schema] of Object.entries(schemas ?? {})) {
    if (!Object.hasOwn(options, name) && schema.default !== undefined) options[name] = typeof schema.default === 'function' ? schema.default(session) : schema.default;
    if (Object.hasOwn(options, name) && options[name] === undefined) issues.push(commandValidationIssue('defaultUndefined', name, locale, { field: `--${name}` }));
    else if (options[name] !== undefined) { const issue = validateValue(`--${name}`, schema, options[name], session, locale); if (issue) issues.push(issue); }
    else if (schema.optional === false) issues.push(commandValidationIssue('missingOption', name, locale));
  }
  const declared = Object.entries(definition.params ?? {});
  for (const [name, declaredSchema] of declared) {
    const schema = definition.$parameter?.name === name ? { ...declaredSchema, optional: definition.$parameter.optional ?? declaredSchema.optional, rest: definition.$parameter.rest ?? declaredSchema.rest } : declaredSchema;
    if (!Object.hasOwn(params, name)) {
      let value: CommandParameterValue | undefined;
      if (schema.rest) {
        const raw = positional.splice(0);
        const converted = schema.type === 'text'
          ? segmentsFromTokens(raw).map((segment) => segment.type === 'text' && typeof segment.data.text === 'string' ? segment.data.text : undefined)
          : raw.map((token) => convert(schema, token));
        if (converted.some((item) => item === undefined)) issues.push(commandValidationIssue('expectedType', name, locale, { type: schema.type }));
        else if (converted.length > 0 || schema.optional) value = converted as readonly (string | number | boolean | Readonly<Record<string, unknown>>)[];
      } else if (schema.type === 'text') {
        const raw: string[] = [];
        while (isTextToken(positional[0])) {
          const token = positional.shift() as Extract<Token, { value: string }>;
          raw.push(`${raw.length > 0 ? token.before || ' ' : ''}${token.raw ?? token.value}${token.after ?? ''}`);
        }
        if (raw.length > 0) value = raw.join('');
      } else if (positional.length > 0) {
        value = convert(schema, positional.shift());
        // Defaults apply to omitted input, never to a supplied value of the wrong type.
        if (value === undefined) {
          issues.push(commandValidationIssue('expectedType', name, locale, { type: schema.type }));
          continue;
        }
      }
      if (value !== undefined) params[name] = value;
      else if (schema.default !== undefined) params[name] = typeof schema.default === 'function' ? schema.default(session) : schema.default;
      else if (!schema.optional && !(definition.$parameter?.name === name && definition.$parameter.optional)) {
        issues.push(commandValidationIssue('expectedType', name, locale, { type: schema.type }));
      }
    }
    if (Object.hasOwn(params, name) && params[name] === undefined) issues.push(commandValidationIssue('parameterUndefined', name, locale));
    else if (params[name] !== undefined) { const effective = definition.$parameter?.name === name && definition.$parameter.rest ? { ...schema, rest: true } : schema; const issue = validateValue(name, effective, params[name], session, locale); if (issue) issues.push(issue); }
  }
  if (declared.length > 0 && !definition.$parameter && positional.length > 0) issues.push(commandValidationIssue('unexpectedArguments', 'arguments', locale));
  return Object.freeze({ params: Object.freeze(params), options: Object.freeze(options), remaining: schemas === undefined && declared.every(([name]) => Object.hasOwn(initial, name)) ? remaining : segmentsFromTokens(positional), issues: Object.freeze(issues) });
}

export function commandUsage(name: string, definition: CommandDefinition): string {
  const parameters = Object.entries(definition.params ?? {}).filter(([key]) => key !== definition.$parameter?.name)
    .map(([key, schema]) => `${schema.optional || schema.default !== undefined ? '[' : '<'}${schema.rest ? '...' : ''}${key}${schema.optional || schema.default !== undefined ? ']' : '>'}`);
  const options = Object.entries(definition.options ?? {}).map(([key, schema]) => `[--${key}${schema.type === 'boolean' ? '' : ` <${schema.type}>`}]`);
  return [name, ...parameters, ...options].join(' ');
}
export function commandHelp(name: string, definition: CommandDefinition, prefix = '', locale: Locale = 'zh-CN'): string {
  return [prefix + commandUsage(name, definition), commandDescription(definition, locale),
    ...Object.entries(definition.params ?? {}).map(([key, schema]) => argumentHelp(key, schema, locale)),
    ...Object.entries(definition.options ?? {}).map(([key, schema]) => argumentHelp(`--${key}${schema.alias ? ` (-${schema.alias})` : ''}`, schema, locale)),
  ].filter(Boolean).join('\n');
}
function argumentHelp(name: string, schema: CommandParamSchema, locale: Locale): string {
  const description = commandDescription(schema, locale);
  return `  ${name}: ${schema.type}${description ? ` — ${description}` : ''}${schema.default !== undefined ? ` (${commandMessages(locale, 'defaultValue', { value: typeof schema.default === 'function' ? commandMessages(locale, 'dynamicValue') : JSON.stringify(schema.default) })})` : ''}${schema.choices ? ` (${schema.choices.join(', ')})` : ''}${schema.min !== undefined ? ` min=${schema.min}` : ''}${schema.max !== undefined ? ` max=${schema.max}` : ''}`;
}
