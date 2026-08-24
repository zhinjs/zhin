#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const hostSource = 'basic/cli/src/plugin-runtime/console-api-installer.ts';
const hostReferencePath = 'packages/im/runtime/src/host-config-schema.json';
const hostReference = JSON.parse(fs.readFileSync(path.join(repoRoot, hostReferencePath), 'utf8'));
const hostRuntimeSource = fs.readFileSync(path.join(repoRoot, hostSource), 'utf8');
const composerSource = 'packages/im/runtime/src/config-composer.ts';
const composer = fs.readFileSync(path.join(repoRoot, composerSource), 'utf8');
if (!hostRuntimeSource.includes("import { HOST_CONFIG_KEYS")
  || !composer.includes("import hostConfigSchema from './host-config-schema.json'")
  || !composer.includes('...HOST_CONFIG_SCHEMA.properties')) {
  throw new Error(`${hostReferencePath} must remain the shared Runtime/Console Host configuration Schema`);
}

function listSchemaFiles(root) {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...listSchemaFiles(absolute));
    else if (entry.name === 'schema.json') result.push(absolute);
  }
  return result.sort();
}

function resolveSchema(schema, rootSchema, fieldPath) {
  if (!schema?.$ref) return schema;
  if (typeof schema.$ref !== 'string' || !schema.$ref.startsWith('#/')) {
    throw new Error(`${fieldPath}: only local JSON Schema references are supported`);
  }
  let resolved = rootSchema;
  for (const rawSegment of schema.$ref.slice(2).split('/')) {
    const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~');
    resolved = resolved?.[segment];
  }
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
    throw new Error(`${fieldPath}: unresolved JSON Schema reference ${schema.$ref}`);
  }
  const { $ref: _reference, ...siblings } = schema;
  return { ...resolved, ...siblings };
}

function displayType(schema, fieldPath, rootSchema = schema) {
  const resolved = resolveSchema(schema, rootSchema, fieldPath);
  if (Array.isArray(resolved.anyOf)) {
    if (resolved.anyOf.length === 0) throw new Error(`${fieldPath}: anyOf must not be empty`);
    return resolved.anyOf.map((option, index) => displayType(option, `${fieldPath}.anyOf[${index}]`, rootSchema)).join(' | ');
  }
  if (resolved.type === 'array' && resolved.items) {
    return `array<${displayType(resolved.items, `${fieldPath}.items`, rootSchema)}>`;
  }
  const type = Array.isArray(resolved.type) ? resolved.type.join(' | ') : resolved.type;
  const base = typeof type === 'string' ? type : resolved.enum ? 'enum' : resolved.properties ? 'object' : undefined;
  if (!base) throw new Error(`${fieldPath}: unsupported Schema shape; add explicit generator support`);
  return resolved.enum ? `${base}: ${resolved.enum.map(formatValue).join(', ')}` : base;
}

function formatValue(value) {
  return value === undefined ? '—' : `\`${JSON.stringify(value)}\``;
}

function escapeCell(value) {
  return String(value ?? '—')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
}

function flattenProperties(schema, prefix, inheritedRequired = new Set(), rootSchema = schema) {
  const resolvedSchema = resolveSchema(schema, rootSchema, prefix);
  const properties = resolvedSchema?.properties && typeof resolvedSchema.properties === 'object'
    ? resolvedSchema.properties
    : {};
  const required = new Set(Array.isArray(resolvedSchema?.required) ? resolvedSchema.required : inheritedRequired);
  const rows = [];
  for (const [key, value] of Object.entries(properties)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    const resolvedValue = resolveSchema(value, rootSchema, fieldPath);
    rows.push({
      path: fieldPath,
      type: displayType(resolvedValue, fieldPath, rootSchema),
      required: required.has(key),
      defaultValue: formatValue(resolvedValue.default),
      description: resolvedValue.description ?? resolvedValue['x-descriptionZh'] ?? '—',
      descriptionZh: resolvedValue['x-descriptionZh'] ?? resolvedValue.description ?? '—',
    });
    if (resolvedValue.type === 'object' || resolvedValue.properties) {
      rows.push(...flattenProperties(resolvedValue, fieldPath, new Set(), rootSchema));
    } else if (resolvedValue.type === 'array' && resolvedValue.items) {
      const resolvedItems = resolveSchema(resolvedValue.items, rootSchema, `${fieldPath}[]`);
      if (resolvedItems.properties) {
        rows.push(...flattenProperties(resolvedItems, `${fieldPath}[]`, new Set(), rootSchema));
      }
    }
    if (resolvedValue.additionalProperties
      && typeof resolvedValue.additionalProperties === 'object'
      && !Array.isArray(resolvedValue.additionalProperties)) {
      const placeholder = resolvedValue['x-keyPlaceholder'] ?? '<key>';
      rows.push(...flattenProperties(
        resolvedValue.additionalProperties,
        `${fieldPath}.${placeholder}`,
        new Set(),
        rootSchema,
      ));
    }
  }
  return rows;
}

function pluginEntries() {
  return listSchemaFiles(path.join(repoRoot, 'plugins')).map((absolute) => {
    const relative = path.relative(repoRoot, absolute).split(path.sep).join('/');
    const schema = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    const segments = relative.split('/');
    const key = segments.at(-2);
    return { key, relative, rows: flattenProperties(schema, `plugins.${key}`, new Set(), schema) };
  });
}

function tableHeader(locale) {
  return locale === 'zh'
    ? '| 路径 | 类型 | 必填 | 默认值 | 说明 |\n| --- | --- | --- | --- | --- |'
    : '| Path | Type | Required | Default | Description |\n| --- | --- | --- | --- | --- |';
}

function render(locale) {
  const zh = locale === 'zh';
  const lines = [
    '---',
    `title: ${zh ? '自动生成配置字段参考' : 'Generated configuration field reference'}`,
    'outline: [2, 3]',
    '---',
    '',
    `# ${zh ? '自动生成配置字段参考' : 'Generated configuration field reference'}`,
    '',
    zh
      ? '> 本页由源码与 JSON Schema 自动生成，请勿手工编辑。叙事、示例与配置方法见[配置参考](./)。'
      : '> Generated from runtime source and JSON Schema. Do not edit manually. See [Configuration](./) for narrative guidance and examples.',
    '',
    `- ${zh ? '生成命令' : 'Generator'}: \`pnpm docs:config\``,
    `- ${zh ? '漂移检查' : 'Drift check'}: \`pnpm check:config-reference\``,
    '',
    `## ${zh ? 'Host 顶层字段' : 'Host top-level fields'}`,
    '',
    zh
      ? `权威契约来自 Runtime 实际消费的 [\`${hostReferencePath}\`](https://github.com/zhinjs/zhin/blob/main/${hostReferencePath})；消费位置见 [\`${hostSource}\`](https://github.com/zhinjs/zhin/blob/main/${hostSource})。`
      : `The authoritative contract is [\`${hostReferencePath}\`](https://github.com/zhinjs/zhin/blob/main/${hostReferencePath}), consumed by the Runtime at [\`${hostSource}\`](https://github.com/zhinjs/zhin/blob/main/${hostSource}).`,
    '',
    tableHeader(locale),
  ];

  for (const row of flattenProperties(hostReference, '', new Set(), hostReference)) {
    lines.push(`| \`${row.path}\` | ${escapeCell(row.type)} | ${row.required ? (zh ? '是' : 'yes') : (zh ? '否' : 'no')} | ${escapeCell(row.defaultValue)} | ${escapeCell(zh ? row.descriptionZh : row.description)} |`);
  }

  lines.push('', `## ${zh ? '插件实例字段' : 'Plugin instance fields'}`, '');
  lines.push(zh
    ? '以下字段直接读取仓库中每个插件发布的 `schema.json`。`plugins.<name>` 中的 `<name>` 是默认 instanceKey。'
    : 'These fields are read directly from each plugin `schema.json`. The `<name>` in `plugins.<name>` is the default instanceKey.');

  for (const plugin of pluginEntries()) {
    lines.push('', `### ${plugin.key}`, '');
    lines.push(`[\`${plugin.relative}\`](https://github.com/zhinjs/zhin/blob/main/${plugin.relative})`, '');
    if (plugin.rows.length === 0) {
      lines.push(zh ? '_该 Schema 没有声明字段。_' : '_This Schema declares no fields._');
      continue;
    }
    lines.push(tableHeader(locale));
    for (const row of plugin.rows) {
      lines.push(`| \`${row.path}\` | ${escapeCell(row.type)} | ${row.required ? (zh ? '是' : 'yes') : (zh ? '否' : 'no')} | ${escapeCell(row.defaultValue)} | ${escapeCell(zh ? row.descriptionZh : row.description)} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}

const outputs = new Map([
  ['docs/configuration/generated.md', render('zh')],
  ['docs/en/configuration/generated.md', render('en')],
]);

const stale = [];
for (const [relative, content] of outputs) {
  const absolute = path.join(repoRoot, relative);
  if (checkOnly) {
    if (!fs.existsSync(absolute) || fs.readFileSync(absolute, 'utf8') !== content) stale.push(relative);
  } else {
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
}

if (stale.length > 0) {
  console.error(`Generated configuration reference is stale:\n- ${stale.join('\n- ')}\nRun pnpm docs:config.`);
  process.exitCode = 1;
} else {
  console.log(checkOnly ? 'Generated configuration reference is current.' : 'Generated configuration reference updated.');
}
