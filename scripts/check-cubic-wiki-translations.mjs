#!/usr/bin/env node
/** Keep the translated Cubic Wiki paired with its pinned English snapshot. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/public/wiki/cubic/source.json'), 'utf8'));
const enDir = path.join(root, 'docs/en/wiki/cubic');
const zhDir = path.join(root, 'docs/wiki/cubic');
const expectedSlugs = `intro quickstart arch-core plugin-runtime message-flow hmr-generation
  commands messaging database scheduling logging ai-orchestration ai-providers
  tools-caps skills memory security-sandbox mcp adapters-core adapters-platforms
  satori speech console-arch console-pages config docker-prod security-policy
  cli-tools testing`.trim().split(/\s+/);
const codeFence = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm;
const expected = expectedSlugs.map(slug => `${slug}.md`).sort();

function article(markdown) {
  const match = /^# .+$/m.exec(markdown);
  if (!match) throw new Error('Article has no first-level heading');
  return markdown.slice(match.index);
}

function matches(text, expression) {
  return [...text.matchAll(expression)].map(match => match[1] ?? match[0]);
}

function signature(markdown) {
  const codeBlocks = [...markdown.matchAll(codeFence)].map(match => match[0]);
  const prose = markdown.replace(codeFence, '');
  const sorted = values => values.sort();
  return {
    codeBlocks,
    inlineCode: sorted(matches(prose, /`[^`\n]+`/g)),
    linkTargets: sorted(matches(prose, /\]\(([^)]+)\)/g).map(target =>
      target.startsWith('/en/') ? target.replace('/en/', '/') : target,
    )),
    headingLevels: sorted(matches(prose, /^(#{1,6}) /gm)),
    tableRows: sorted(prose.split('\n').filter(line => line.startsWith('|')).map(line =>
      (line.match(/\|/g) ?? []).length,
    )),
  };
}

function sourceFileTargets(markdown) {
  const details = /^::: details [^\n]+\n([\s\S]*?)^:::[ \t]*$/m.exec(markdown);
  if (!details) throw new Error('Article has no source-file details block');
  return matches(details[1], /\]\(([^)]+)\)/g).sort();
}

const pageFiles = manifest.pages.map(page => page.file).sort();
const pageIds = manifest.pages.map(page => page.id).sort();
const expectedIds = expectedSlugs.map(slug => `page-${slug}`).sort();
if (JSON.stringify(pageFiles) !== JSON.stringify(expected) || JSON.stringify(pageIds) !== JSON.stringify(expectedIds)) {
  throw new Error('Manifest does not contain the exact 29 expected Wiki pages');
}
for (const [name, directory] of [['English', enDir], ['Chinese', zhDir]]) {
  const actual = fs.readdirSync(directory).filter(file => file.endsWith('.md')).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${name} Wiki page set differs: expected ${expected.length}, got ${actual.length}`);
  }
}

for (const page of manifest.pages) {
  const slug = page.file.slice(0, -3);
  const english = fs.readFileSync(path.join(enDir, page.file), 'utf8');
  const chinese = fs.readFileSync(path.join(zhDir, page.file), 'utf8');
  const bodyMarker = '\n::: details Relevant source files\n';
  if (english.split(bodyMarker).length !== 2) {
    throw new Error(`${page.file}: missing or duplicated normalized body marker`);
  }
  const normalizedBody = `::: details Relevant source files\n${english.split(bodyMarker)[1]}`;
  const englishHash = createHash('sha256').update(normalizedBody).digest('hex');
  if (englishHash !== page.body_sha256) {
    throw new Error(`${page.file}: English body differs from the manifest`);
  }
  if (!chinese.includes(`translation_normalized_body_sha256: ${englishHash}`)) {
    throw new Error(`${page.file}: translation does not match the current English snapshot hash`);
  }
  if (!chinese.includes(`[英文原文](/en/wiki/cubic/${slug})`)) {
    throw new Error(`${page.file}: missing English counterpart link`);
  }
  if (matches(article(chinese), /[\u4e00-\u9fff]/g).length < 100) {
    throw new Error(`${page.file}: Chinese article has too little translated prose`);
  }
  if (JSON.stringify(sourceFileTargets(english)) !== JSON.stringify(sourceFileTargets(chinese))) {
    throw new Error(`${page.file}: source-file links differ from English article`);
  }
  const source = signature(article(english));
  const translation = signature(article(chinese));
  for (const key of Object.keys(source)) {
    if (JSON.stringify(source[key]) !== JSON.stringify(translation[key])) {
      throw new Error(`${page.file}: ${key} differs from English article`);
    }
  }
}

console.log(`Verified ${manifest.pages.length} Chinese Wiki translations against the English snapshot`);
