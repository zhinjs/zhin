import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const adapterSlugs = fs.readdirSync(path.join(repoRoot, 'plugins/adapters'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(repoRoot, 'plugins/adapters', entry.name, 'README.md')))
  .map((entry) => entry.name);

const operationalSections = {
  prerequisites: /^## (前置条件|Prerequisites)$/mu,
  configuration: /^## (最小配置(?:（[^\n]+）)?|配置(?:（[^\n]+）)?|Minimal Configuration(?: \([^\n]+\))?|Minimal config|Configuration(?: \([^\n]+\))?)$/mu,
  troubleshooting: /^## (故障排查|Troubleshooting)$/mu,
};

describe('product documentation operability', () => {
  it('each adapter source README and English page closes the operating loop', () => {
    for (const slug of adapterSlugs) {
      for (const relativePath of [
        `plugins/adapters/${slug}/README.md`,
        `docs/en/adapters/${slug}.md`,
      ]) {
        const content = read(relativePath);
        for (const [section, pattern] of Object.entries(operationalSections)) {
          expect(content, `${relativePath} missing ${section}`).toMatch(pattern);
        }
      }
    }
  });

  it('English adapter pages do not retain removed side-event claims', () => {
    for (const slug of adapterSlugs) {
      const content = read(`docs/en/adapters/${slug}.md`);
      expect(content, slug).not.toMatch(/side events have been removed/i);
      expect(content, slug).not.toMatch(/notice \/ request events are silently discarded/i);
    }
  });

  it('Console guides diagnosis from symptom to runtime fact', () => {
    for (const relativePath of ['docs/console/index.md', 'docs/en/console/index.md']) {
      const content = read(relativePath);
      expect(content, relativePath).toMatch(/recovery gap/i);
      expect(content, relativePath).toMatch(/Runtime Capabilities|运行时能力/);
      expect(content, relativePath).toMatch(/Persistent Workroom Catalog|持久 Workroom Catalog/);
      expect(content, relativePath).toMatch(/event stream and history|事件流与历史/);
      expect(content, relativePath).not.toMatch(/config:get\/set\(ai\)/);
    }
  });

  it('plugin delivery covers topology, lifecycle, acceptance, and release', () => {
    for (const relativePath of [
      'docs/authoring/plugin-delivery.md',
      'docs/en/authoring/plugin-delivery.md',
    ]) {
      const content = read(relativePath);
      expect(content, relativePath).toContain('package.json#zhin');
      expect(content, relativePath).toContain('lifecycle');
      expect(content, relativePath).toContain('handoff');
      expect(content, relativePath).toContain('check:plugin-agent-publish');
    }
  });
});
