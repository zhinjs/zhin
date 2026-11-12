import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertFeatureLevelDeclarations, overridableFields } from '../../packages/im/runtime/src/layered-config.js';

/**
 * ADR 0050 / 0055 for official plugins: every non-adapter plugin with configuration fields declares
 * all four levels, so the Console feature pages (which list a plugin at a level only when it declares
 * that level or has no fields) show its switch on adapter, account and conversation pages.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LEVELS = ['global', 'adapter', 'endpoint', 'conversation'];

function officialPlugins(): { name: string; schema: Record<string, unknown> | undefined }[] {
  const result = [];
  for (const group of ['utils', 'games', 'services', 'features']) {
    const dir = path.join(repoRoot, 'plugins', group);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !fs.existsSync(path.join(dir, entry.name, 'package.json'))) continue;
      const file = path.join(dir, entry.name, 'schema.json');
      result.push({ name: `${group}/${entry.name}`, schema: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined });
    }
  }
  return result;
}

/** Mirror of the Console filter (`featuresAtLevel` in console-ui feature-model.mjs). */
function shownAt(schema: Record<string, unknown> | undefined, level: string): boolean {
  const properties = schema?.properties && typeof schema.properties === 'object' ? Object.keys(schema.properties) : [];
  const levels = (schema?.['x-zhin-config'] as { levels?: string[] } | undefined)?.levels ?? ['global'];
  return levels.includes(level) || properties.length === 0;
}

describe('official plugin feature levels (ADR 0050 / 0055)', () => {
  const plugins = officialPlugins();
  it('finds the official plugins', () => { expect(plugins.length).toBeGreaterThan(20); });

  it.each(plugins.map(plugin => [plugin.name, plugin.schema] as const))('%s is listed on every Console feature level', (_name, schema) => {
    for (const level of LEVELS) expect(shownAt(schema, level)).toBe(true);
    if (!schema || Object.keys((schema.properties as object | undefined) ?? {}).length === 0) return;
    expect((schema['x-zhin-config'] as { levels: string[] }).levels).toEqual(LEVELS);
    expect(() => assertFeatureLevelDeclarations(schema)).not.toThrow();
    // Secrets never become overridable below global.
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    for (const level of ['adapter', 'endpoint', 'conversation'] as const) {
      for (const field of overridableFields(schema, level)) {
        expect(properties[field]?.writeOnly, `${field} at ${level}`).not.toBe(true);
        expect((properties[field]?.['x-zhin-config'] as { secret?: boolean } | undefined)?.secret, `${field} at ${level}`).not.toBe(true);
      }
    }
  });
});
