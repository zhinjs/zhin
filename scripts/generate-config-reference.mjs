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

function displayType(schema, fieldPath) {
  if (Array.isArray(schema.anyOf)) {
    if (schema.anyOf.length === 0) throw new Error(`${fieldPath}: anyOf must not be empty`);
    return schema.anyOf.map((option, index) => displayType(option, `${fieldPath}.anyOf[${index}]`)).join(' | ');
  }
  if (schema.type === 'array' && schema.items) {
    return `array<${displayType(schema.items, `${fieldPath}.items`)}>`;
  }
  const type = Array.isArray(schema.type) ? schema.type.join(' | ') : schema.type;
  const base = typeof type === 'string' ? type : schema.enum ? 'enum' : schema.properties ? 'object' : undefined;
  if (!base) throw new Error(`${fieldPath}: unsupported Schema shape; add explicit generator support`);
  return schema.enum ? `${base}: ${schema.enum.map(formatValue).join(', ')}` : base;
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

function flattenProperties(schema, prefix, inheritedRequired = new Set()) {
  const properties = schema?.properties && typeof schema.properties === 'object'
    ? schema.properties
    : {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required : inheritedRequired);
  const rows = [];
  for (const [key, value] of Object.entries(properties)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const fieldPath = `${prefix}.${key}`;
    rows.push({
      path: fieldPath,
      type: displayType(value, fieldPath),
      required: required.has(key),
      defaultValue: formatValue(value.default),
      description: value.description ?? '—',
    });
    if (value.type === 'object' || value.properties) {
      rows.push(...flattenProperties(value, fieldPath));
    } else if (value.type === 'array' && value.items?.properties) {
      rows.push(...flattenProperties(value.items, `${fieldPath}[]`));
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
    return { key, relative, rows: flattenProperties(schema, `plugins.${key}`) };
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
    zh
      ? '| 路径 | 类型 | 说明 | 来源 |\n| --- | --- | --- | --- |'
      : '| Path | Type | Description | Source |\n| --- | --- | --- | --- |',
  ];

  for (const [key, schema] of Object.entries(hostReference.properties ?? {})) {
    const description = locale === 'zh' ? schema['x-descriptionZh'] : schema.description;
    if (!description) {
      throw new Error(`${hostReferencePath}#properties.${key} is missing generated-doc metadata`);
    }
    lines.push(`| \`${key}\` | ${escapeCell(displayType(schema, key))} | ${escapeCell(description)} | [source](https://github.com/zhinjs/zhin/blob/main/${hostReferencePath}) |`);
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
      lines.push(`| \`${row.path}\` | ${escapeCell(row.type)} | ${row.required ? (zh ? '是' : 'yes') : (zh ? '否' : 'no')} | ${escapeCell(row.defaultValue)} | ${escapeCell(row.description)} |`);
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
