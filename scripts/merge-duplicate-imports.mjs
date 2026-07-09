#!/usr/bin/env node
/**
 * Merge duplicate import statements from the same module (no-duplicate-imports).
 * Usage: node scripts/merge-duplicate-imports.mjs <dir>
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.argv[2];
if (!root) {
  console.error('Usage: node scripts/merge-duplicate-imports.mjs <dir>');
  process.exit(1);
}

const IMPORT_STMT_RE = /import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

function parseSpecifiers(clause) {
  const trimmed = clause.trim();
  if (!trimmed || trimmed === 'type') return { kind: 'side-effect' };
  if (/^\*\s+as\s+\w+$/.test(trimmed)) return { kind: 'namespace', text: trimmed };
  if (/^\w+$/.test(trimmed)) return { kind: 'default', text: trimmed };
  const brace = trimmed.match(/^\{([\s\S]*)\}$/);
  if (!brace) return { kind: 'unknown', text: trimmed };
  const parts = brace[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { kind: 'named', parts };
}

function mergeNamed(parts) {
  const seen = new Set();
  const merged = [];
  for (const part of parts) {
    if (!seen.has(part)) {
      seen.add(part);
      merged.push(part);
    }
  }
  return merged;
}

function findImportBlock(content) {
  const lead = content.match(/^(\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*)/);
  const offset = lead?.[0].length ?? 0;
  const tail = content.slice(offset);
  const blockMatch = tail.match(/^((?:\s*import[\s\S]*?;\s*\n)+)/);
  if (!blockMatch) return null;
  return { offset, importBlock: blockMatch[1], rest: tail.slice(blockMatch[0].length) };
}

function mergeImports(content) {
  const found = findImportBlock(content);
  if (!found) return null;

  const { offset, importBlock, rest } = found;
  const statements = [];
  for (const m of importBlock.matchAll(IMPORT_STMT_RE)) {
    statements.push({
      isTypeOnly: Boolean(m[1]),
      clause: m[2].trim(),
      module: m[3],
      raw: m[0],
    });
  }
  if (statements.length < 2) return null;

  const byModule = new Map();
  for (const stmt of statements) {
    const list = byModule.get(stmt.module) ?? [];
    list.push(stmt);
    byModule.set(stmt.module, list);
  }

  let changed = false;
  const output = [];

  for (const stmt of statements) {
    const group = byModule.get(stmt.module);
    if (!group || group._done) continue;
    group._done = true;

    if (group.length === 1) {
      output.push(`import ${group[0].isTypeOnly ? 'type ' : ''}${group[0].clause} from '${group[0].module}';`);
      continue;
    }

    changed = true;
    const parsed = group.map((s) => ({ ...parseSpecifiers(s.clause), isTypeOnly: s.isTypeOnly }));

    if (parsed.some((p) => p.kind === 'unknown' || p.kind === 'side-effect')) {
      for (const s of group) {
        output.push(`import ${s.isTypeOnly ? 'type ' : ''}${s.clause} from '${s.module}';`);
      }
      changed = false;
      continue;
    }

    const namespaces = parsed.filter((p) => p.kind === 'namespace');
    const defaults = parsed.filter((p) => p.kind === 'default');
    if (namespaces.length > 1 || defaults.length > 1 || (namespaces.length && defaults.length)) {
      for (const s of group) {
        output.push(`import ${s.isTypeOnly ? 'type ' : ''}${s.clause} from '${s.module}';`);
      }
      changed = false;
      continue;
    }

    const namedParts = [];
    let hasValue = false;
    for (const p of parsed) {
      if (p.kind === 'default' || p.kind === 'namespace') hasValue = true;
      if (p.kind === 'named') {
        for (const part of p.parts) {
          const inlineType = /^type\s+/.test(part);
          const isType = p.isTypeOnly || inlineType;
          if (!isType) hasValue = true;
        }
      }
    }

    for (const p of parsed) {
      if (p.kind === 'named') {
        for (const part of p.parts) {
          const inlineType = /^type\s+/.test(part);
          const bare = inlineType ? part.replace(/^type\s+/, '') : part;
          const isType = p.isTypeOnly || inlineType;
          namedParts.push(hasValue && isType ? `type ${bare}` : bare);
        }
      }
    }

    const clauses = [];
    if (defaults[0]) clauses.push(defaults[0].text);
    if (namespaces[0]) clauses.push(namespaces[0].text);
    if (namedParts.length) clauses.push(`{ ${mergeNamed(namedParts).join(', ')} }`);

    const allTypeOnly = !hasValue && !defaults[0] && !namespaces[0];
    const prefix = allTypeOnly ? 'import type ' : 'import ';
    const body = clauses.join(', ');
    output.push(`${prefix}${body} from '${group[0].module}';`);
  }

  if (!changed) return null;
  const lead = content.slice(0, offset);
  return `${lead}${output.join('\n')}\n${rest}`;
}

let touched = 0;
for (const file of walk(root)) {
  const original = readFileSync(file, 'utf8');
  const merged = mergeImports(original);
  if (merged && merged !== original) {
    writeFileSync(file, merged);
    touched += 1;
    console.log(relative(process.cwd(), file));
  }
}

console.log(`merged ${touched} file(s)`);
