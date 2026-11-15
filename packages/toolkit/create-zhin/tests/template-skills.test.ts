import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const skillsDir = fileURLToPath(new URL('../template/skills/', import.meta.url));
const CJK = /[\p{Script=Han}]/u;

function frontmatter(name: string): { description: string; keywords?: string[] } {
  const text = readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/u);
  if (!match) throw new Error(`${name}/SKILL.md has no front matter`);
  return parse(match[1]!) as { description: string; keywords?: string[] };
}

/**
 * #1250 b27: the Agent's skill catalog lists the description's first sentence, `Use when` clause,
 * `Triggers:` list and the `keywords`. Chinese trigger words must reach it even when the English
 * first sentence is long, so every scaffolded skill names its Chinese triggers in `keywords`
 * (or opens with a Chinese first sentence).
 */
describe('scaffold template skills', () => {
  const names = readdirSync(skillsDir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);

  it('ships skills', () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it.each(names)('%s lists its Chinese trigger words in keywords', (name) => {
    const { description, keywords = [] } = frontmatter(name);
    expect(keywords.some(keyword => CJK.test(keyword))).toBe(true);
    const triggers = description.match(/Triggers:\s*([^"]*?)\.?$/u)?.[1]?.split(/\s*,\s*/u) ?? [];
    const normalized = new Set(keywords.map(keyword => keyword.toLowerCase()));
    for (const trigger of triggers.filter(word => CJK.test(word))) {
      expect(normalized.has(trigger.toLowerCase()), `${name}: "${trigger}" missing from keywords`).toBe(true);
    }
  });
});
