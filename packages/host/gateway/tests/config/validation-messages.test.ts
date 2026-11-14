import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createConfigDocument } from '@zhin.js/runtime';
import { ConsoleConfigurationStore } from '../../src/config/configuration.js';
import { formatSchemaIssue } from '../../src/config/validation-messages.js';

const tempRoots: string[] = [];
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['token'],
  properties: {
    token: { type: 'string', minLength: 8, maxLength: 12, pattern: '^[a-z]+$' },
    port: { type: 'integer', minimum: 1, maximum: 65535 },
    ratio: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 },
    mode: { enum: ['a', 'b'] },
    fixed: { const: 'x' },
    tags: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } },
    nested: { type: 'object', properties: { url: { type: 'string', maxLength: 3 } } },
  },
};

/** Every value below breaks exactly the constraint named in its key. */
const invalid = {
  port: 70000, ratio: 1, mode: 'c', fixed: 'y', tags: [], extra: true, nested: { url: 'too long' },
};

async function validate(locale: string | undefined, value: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-config-i18n-'));
  tempRoots.push(root);
  await writeFile(join(root, 'zhin.config.yml'), `configVersion: 2\n${locale ? `locale: ${locale}\n` : ''}plugins: {}\nplugin: {}\n`);
  await writeFile(join(root, 'schema.json'), JSON.stringify(schema));
  const store = new ConsoleConfigurationStore({ projectRoot: root, document: createConfigDocument(join(root, 'zhin.config.yml')) });
  return store.validatePluginConfig('plugin', value);
}

describe('localized configuration validation messages (#1250)', () => {
  it('names the field in Chinese for every common keyword by default', async () => {
    const result = await validate(undefined, invalid);
    expect(result.valid).toBe(false);
    expect(Object.fromEntries(result.errors.map(error => [error.path, error.message]))).toEqual({
      '$.token': '缺少必填字段 token',
      '$.extra': '不支持的字段 extra',
      '$.port': '字段 port 不能大于 65535',
      '$.ratio': '字段 ratio 必须小于 1',
      '$.mode': '字段 mode 必须是以下值之一：a, b',
      '$.fixed': '字段 fixed 必须等于 x',
      '$.tags': '字段 tags 至少需要 1 项',
      '$.nested.url': '字段 nested.url 长度不能超过 3 个字符',
    });
  });

  it('uses English for a project with locale: en, with no Chinese left', async () => {
    const result = await validate('en', { ...invalid, token: 'ABC', port: 0, ratio: 0, tags: ['a', 'b', 'c'] });
    const messages = Object.fromEntries(result.errors.map(error => [error.path, error.message]));
    expect(messages).toMatchObject({
      '$.extra': 'unknown field extra',
      '$.port': 'Field port must be at least 1',
      '$.ratio': 'Field ratio must be greater than 0',
      '$.mode': 'Field mode must be one of: a, b',
      '$.fixed': 'Field fixed must equal x',
      '$.tags': 'Field tags must have at most 2 items',
      '$.nested.url': 'Field nested.url must be at most 3 characters long',
    });
    expect(result.errors.map(error => error.message)).toEqual(expect.arrayContaining([
      'Field token must be at least 8 characters long',
      'Field token must match the pattern ^[a-z]+$',
    ]));
    for (const { message } of result.errors) expect(message).not.toMatch(/[一-鿿]/u);
  });

  it('covers the remaining keywords and falls back to the Ajv text for others', () => {
    expect(formatSchemaIssue({ keyword: 'maxLength', params: { limit: 4 } }, ['name'], 'zh-CN')).toBe('字段 name 长度不能超过 4 个字符');
    expect(formatSchemaIssue({ keyword: 'minimum', params: { limit: 1 } }, [], 'zh-CN')).toBe('不能小于 1');
    expect(formatSchemaIssue({ keyword: 'exclusiveMinimum', params: { limit: 0 } }, ['a'], 'zh-CN')).toBe('字段 a 必须大于 0');
    expect(formatSchemaIssue({ keyword: 'maxItems', params: { limit: 2 } }, ['a'], 'zh-CN')).toBe('字段 a 最多只能有 2 项');
    // `format` is reported by Ajv only when a schema author registers formats.
    expect(formatSchemaIssue({ keyword: 'format', params: { format: 'uri' } }, ['url'], 'zh-CN')).toBe('字段 url 应为有效的 uri');
    expect(formatSchemaIssue({ keyword: 'format', params: { format: 'uri' } }, ['url'], 'en')).toBe('Field url must be a valid uri');
    expect(formatSchemaIssue({ keyword: 'type', params: { type: 'array' } }, ['a'], 'en')).toBe('Field a must be of type list');
    expect(formatSchemaIssue({ keyword: 'required', params: { missingProperty: 'id' } }, ['endpoints', '0'], 'en')).toBe('missing required field endpoints.0.id');
    expect(formatSchemaIssue({ keyword: 'multipleOf', params: { multipleOf: 2 }, message: 'must be multiple of 2' }, ['n'], 'zh-CN'))
      .toBe('字段 n 不满足 multipleOf 约束（must be multiple of 2）');
    expect(formatSchemaIssue({ keyword: 'minimum', params: { limit: 1 } }, ['n'], 'fr')).toBe('字段 n 不能小于 1');
  });
});
