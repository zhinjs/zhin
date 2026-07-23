#!/usr/bin/env node
/**
 * One-shot codemod: plugin agent/tools with `execute(input: any)` → typed destructuring.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ZOD_TYPE = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
};

function parseZodFields(content) {
  const objMatch = content.match(/inputSchema:\s*z\.object\(\{([\s\S]*?)\}\s*\)/);
  if (!objMatch) return null;
  const body = objMatch[1];
  /** @type {{ name: string; type: string; optional: boolean }[]} */
  const fields = [];
  const re = /(\w+)\s*:\s*z\.(string|number|boolean|coerce\.number)\([^)]*\)(?:\.optional\(\))?(?:\.describe\([^)]*\))?(?:\.optional\(\))?/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const [, name, zodKind] = m;
    const slice = body.slice(m.index, m.index + m[0].length + 20);
    const optional = /\.optional\(\)/.test(slice);
    let tsType = 'string';
    if (zodKind === 'number' || zodKind === 'coerce.number') tsType = 'number';
    if (zodKind === 'boolean') tsType = 'boolean';
    fields.push({ name, type: tsType, optional });
  }
  return fields.length ? fields : null;
}

function buildTypeLiteral(fields) {
  return `{ ${fields.map((f) => `${f.name}${f.optional ? '?' : ''}: ${f.type}`).join('; ')} }`;
}

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (!/async execute\(input: (any|Record<string, any>)\)/.test(content)) return false;

  const fields = parseZodFields(content);
  if (!fields) return false;

  const typeLiteral = buildTypeLiteral(fields);
  const names = fields.map((f) => f.name).join(', ');

  if (!/defineTool<\{/.test(content)) {
    content = content.replace(/export default defineTool\(\{/, `export default defineTool<${typeLiteral}>({`);
  }

  content = content.replace(
    /async execute\(input: (?:any|Record<string, any>)\)\s*\{[\s\n]*const\s*\{\s*([^}]+)\s*\}\s*=\s*input;/,
    `async execute({ $1 }: ${typeLiteral}) {`,
  );

  if (/async execute\(input: (?:any|Record<string, any>)\)/.test(content)) {
    content = content.replace(
      /async execute\(input: (?:any|Record<string, any>)\)\s*\{/,
      `async execute({ ${names} }: ${typeLiteral}) {`,
    );
  }

  for (const f of fields) {
    content = content.replaceAll(`input.${f.name}!`, f.name);
    content = content.replaceAll(`input.${f.name}`, f.name);
  }

  fs.writeFileSync(filePath, content);
  return true;
}

function walk(dir) {
  let n = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) n += walk(abs);
    else if (ent.name.endsWith('.ts') && abs.includes(`${path.sep}agent${path.sep}`)) {
      if (fixFile(abs)) {
        console.log(path.relative(repoRoot, abs));
        n++;
      }
    }
  }
  return n;
}

const pluginsRoot = path.join(repoRoot, 'plugins');
let total = 0;
for (const cat of fs.readdirSync(pluginsRoot)) {
  const catPath = path.join(pluginsRoot, cat);
  if (fs.statSync(catPath).isDirectory()) total += walk(catPath);
}
console.log(`fixed ${total} agent tool files`);
