#!/usr/bin/env node
/** Merge duplicate imports from the same module in a file. */
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} content
 */
function mergeDuplicateImports(content) {
  const importRe = /^import\s+(type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm;
  /** @type {Map<string, { typeOnly: boolean; names: Set<string> }[]>} */
  const byModule = new Map();
  /** @type {{ start: number; end: number; text: string }[]} */
  const blocks = [];

  let m;
  while ((m = importRe.exec(content)) !== null) {
    const typeOnly = Boolean(m[1]);
    const names = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    const mod = m[3];
    blocks.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    if (!byModule.has(mod)) byModule.set(mod, []);
    byModule.get(mod).push({ typeOnly, names: new Set(names) });
  }

  const dupMods = [...byModule.entries()].filter(([, entries]) => entries.length > 1);
  if (!dupMods.length) return content;

  let out = content;
  for (const [mod, entries] of dupMods) {
    /** @type {Set<string>} */
    const typeNames = new Set();
    /** @type {Set<string>} */
    const valueNames = new Set();
    for (const e of entries) {
      for (const n of e.names) {
        const isType = n.startsWith('type ');
        const bare = isType ? n.slice(5).trim() : n;
        if (e.typeOnly || isType) typeNames.add(bare);
        else valueNames.add(bare);
      }
    }
    for (const t of typeNames) valueNames.delete(t);
    const parts = [...valueNames, ...[...typeNames].map((t) => `type ${t}`)];
    const merged = `import { ${parts.join(', ')} } from '${mod}';`;
    const toRemove = blocks.filter((b) => b.text.includes(`from '${mod}'`) || b.text.includes(`from "${mod}"`));
    if (!toRemove.length) continue;
    const first = toRemove[0].start;
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const b = toRemove[i];
      out = out.slice(0, b.start) + (i === 0 ? merged : '') + out.slice(b.end);
    }
    // Re-run on changed content for next module
    return mergeDuplicateImports(out);
  }
  return out;
}

/**
 * @param {string} file
 */
function processFile(file) {
  const before = fs.readFileSync(file, 'utf8');
  const after = mergeDuplicateImports(before);
  if (after !== before) {
    fs.writeFileSync(file, after);
    console.log(file);
  }
}

/**
 * @param {string} dir
 */
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs);
    else if (ent.name.endsWith('.ts') && !abs.includes(`${path.sep}lib${path.sep}`)) processFile(abs);
  }
}

const target = process.argv[2];
if (!target) {
  console.error('usage: merge-duplicate-imports.mjs <dir>');
  process.exit(1);
}
walk(path.resolve(target));
