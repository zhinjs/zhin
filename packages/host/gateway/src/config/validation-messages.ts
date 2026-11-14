import { createMessages, resolveLocale, type Locale } from '@zhin.js/plugin-runtime';

/** The parts of an Ajv `ErrorObject` a configuration message needs. */
export interface SchemaIssue {
  readonly keyword: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly message?: string;
}

const messages = createMessages({
  type: { 'zh-CN': '{field}类型应为 {type}', en: '{field}must be of type {type}' },
  maximum: { 'zh-CN': '{field}不能大于 {limit}', en: '{field}must be at most {limit}' },
  minimum: { 'zh-CN': '{field}不能小于 {limit}', en: '{field}must be at least {limit}' },
  exclusiveMaximum: { 'zh-CN': '{field}必须小于 {limit}', en: '{field}must be less than {limit}' },
  exclusiveMinimum: { 'zh-CN': '{field}必须大于 {limit}', en: '{field}must be greater than {limit}' },
  minLength: { 'zh-CN': '{field}长度不能少于 {limit} 个字符', en: '{field}must be at least {limit} characters long' },
  maxLength: { 'zh-CN': '{field}长度不能超过 {limit} 个字符', en: '{field}must be at most {limit} characters long' },
  enum: { 'zh-CN': '{field}必须是以下值之一：{values}', en: '{field}must be one of: {values}' },
  const: { 'zh-CN': '{field}必须等于 {value}', en: '{field}must equal {value}' },
  pattern: { 'zh-CN': '{field}格式不符合 {pattern}', en: '{field}must match the pattern {pattern}' },
  environmentReference: { 'zh-CN': '{field}只接受数值或 {reference} 形式的环境变量引用', en: '{field}accepts only a number or a {reference} environment reference' },
  required: { 'zh-CN': '缺少必填字段 {property}', en: 'missing required field {property}' },
  additionalProperties: { 'zh-CN': '不支持的字段 {property}', en: 'unknown field {property}' },
  format: { 'zh-CN': '{field}应为有效的 {format}', en: '{field}must be a valid {format}' },
  minItems: { 'zh-CN': '{field}至少需要 {limit} 项', en: '{field}must have at least {limit} items' },
  maxItems: { 'zh-CN': '{field}最多只能有 {limit} 项', en: '{field}must have at most {limit} items' },
  fallback: { 'zh-CN': '{field}不满足 {keyword} 约束（{detail}）', en: '{field}does not satisfy {keyword} ({detail})' },
  field: { 'zh-CN': '字段 {path} ', en: 'Field {path} ' },
});

/** Schema `pattern` of a value that may be a string only as one whole `${VAR}` reference. */
export const ENVIRONMENT_REFERENCE_SCHEMA_PATTERN = '^\\$\\{[A-Za-z_][A-Za-z0-9_]*(?::[-=][^}]*)?\\}$';

const NUMERIC_LIMITS = new Set(['maximum', 'minimum', 'exclusiveMaximum', 'exclusiveMinimum', 'minLength', 'maxLength', 'minItems', 'maxItems']);

function display(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Localized text for one Ajv issue of a Plugin configuration, in the project `locale`
 * (`zh-CN` by default). `location` is the field path inside the configuration block; it is named in
 * the message so a reader sees which field is wrong without matching it to the separate path.
 */
export function formatSchemaIssue(issue: SchemaIssue, location: readonly string[], locale: Locale | unknown): string {
  const lang = resolveLocale(locale);
  const field = location.length > 0 ? messages(lang, 'field', { path: location.join('.') }) : '';
  const params = issue.params;
  switch (issue.keyword) {
    case 'type': {
      const type = Array.isArray(params.type) ? params.type.join(' | ') : String(params.type);
      return messages(lang, 'type', { field, type: type === 'array' ? 'list' : type });
    }
    case 'enum': {
      const allowed = Array.isArray(params.allowedValues) ? params.allowedValues.map(display).join(', ') : display(params.allowedValues);
      return messages(lang, 'enum', { field, values: allowed });
    }
    case 'const':
      return messages(lang, 'const', { field, value: display(params.allowedValue) });
    case 'pattern':
      // A string allowed only as a whole `${VAR}` reference (e.g. `http.port`): say so plainly.
      if (String(params.pattern) === ENVIRONMENT_REFERENCE_SCHEMA_PATTERN) {
        return messages(lang, 'environmentReference', { field, reference: '${VAR}' });
      }
      return messages(lang, 'pattern', { field, pattern: String(params.pattern) });
    case 'format':
      return messages(lang, 'format', { field, format: String(params.format) });
    case 'required':
      return messages(lang, 'required', { property: [...location, String(params.missingProperty)].join('.') });
    case 'additionalProperties':
      return messages(lang, 'additionalProperties', { property: [...location, String(params.additionalProperty)].join('.') });
    default:
      if (NUMERIC_LIMITS.has(issue.keyword) && (typeof params.limit === 'number' || typeof params.limit === 'string')) {
        return messages(lang, issue.keyword as 'maximum', { field, limit: params.limit });
      }
      return messages(lang, 'fallback', { field, keyword: issue.keyword, detail: issue.message ?? issue.keyword });
  }
}
