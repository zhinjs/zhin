#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const catalogPath = 'docs/troubleshooting/catalog.json';
const catalog = JSON.parse(fs.readFileSync(path.join(repoRoot, catalogPath), 'utf8'));
const catalogSchema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'docs/troubleshooting/catalog.schema.json'), 'utf8'));

function assertCatalog() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  if (!ajv.validate(catalogSchema, catalog)) {
    throw new Error(`Troubleshooting catalog Schema validation failed: ${ajv.errorsText(ajv.errors, { separator: '\n' })}`);
  }
  const ids = new Set();
  if (!Array.isArray(catalog.entries) || catalog.entries.length === 0) throw new Error('Troubleshooting catalog must contain entries.');
  for (const entry of catalog.entries) {
    if (!/^[a-z0-9-]+$/u.test(entry.id) || ids.has(entry.id)) throw new Error(`Invalid or duplicate troubleshooting id: ${entry.id}`);
    ids.add(entry.id);
    for (const field of ['title', 'symptom']) {
      if (!entry[field]?.zh?.trim() || !entry[field]?.en?.trim()) throw new Error(`${entry.id}.${field} must be bilingual.`);
    }
    for (const field of ['causes', 'actions', 'verification']) {
      if (!Array.isArray(entry[field]) || entry[field].length === 0 || entry[field].some((item) => !item?.zh?.trim() || !item?.en?.trim())) {
        throw new Error(`${entry.id}.${field} must be a non-empty bilingual list.`);
      }
    }
  }
}

function renderList(items, locale) {
  return items.map((item) => `- ${item[locale]}`).join('\n');
}

function render(locale) {
  const zh = locale === 'zh';
  const lines = [
    '---',
    `title: ${zh ? '故障排查中心' : 'Troubleshooting Center'}`,
    'outline: [2, 3]',
    '---',
    '',
    `# ${zh ? '故障排查中心' : 'Troubleshooting Center'}`,
    '',
    zh
      ? '> 本页由结构化故障目录生成。每个问题都遵循“症状 → 原因 → 操作 → 验证”，请勿跳过最后的验证。'
      : '> This page is generated from a structured incident catalog. Every issue follows “Symptom → Cause → Action → Verification”; do not skip verification.',
    '',
    zh ? '先从症状定位条目。一次只改变一个条件，并保留启动日志、Trace 与 generation 信息。' : 'Start from the symptom. Change one condition at a time and retain startup logs, Trace, and generation details.',
    '',
    `## ${zh ? '快速定位' : 'Quick index'}`,
    '',
    ...catalog.entries.map((entry) => `- [${entry.title[locale]}](#${entry.id})`),
  ];

  for (const entry of catalog.entries) {
    lines.push(
      '',
      `<section id="${entry.id}">`,
      '',
      `## ${entry.title[locale]}`,
      '',
      `### ${zh ? '症状' : 'Symptom'}`,
      '',
      entry.symptom[locale],
      '',
      `### ${zh ? '原因' : 'Cause'}`,
      '',
      renderList(entry.causes, locale),
      '',
      `### ${zh ? '操作' : 'Action'}`,
      '',
      renderList(entry.actions, locale),
      '',
      `### ${zh ? '验证' : 'Verification'}`,
      '',
      renderList(entry.verification, locale),
      '',
      '</section>',
    );
  }
  return `${lines.join('\n')}\n`;
}

assertCatalog();
const outputs = new Map([
  ['docs/troubleshooting/index.md', render('zh')],
  ['docs/en/troubleshooting/index.md', render('en')],
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
  console.error(`Generated troubleshooting pages are stale:\n- ${stale.join('\n- ')}\nRun pnpm docs:troubleshooting.`);
  process.exitCode = 1;
} else {
  console.log(checkOnly ? 'Generated troubleshooting pages are current.' : 'Generated troubleshooting pages updated.');
}
