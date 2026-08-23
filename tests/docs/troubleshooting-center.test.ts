import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

type Localized = { zh: string; en: string };
type TroubleshootingEntry = {
  id: string;
  title: Localized;
  symptom: Localized;
  causes: Localized[];
  actions: Localized[];
  verification: Localized[];
};

describe('troubleshooting center', () => {
  it('is reproducible from the structured catalog', () => {
    expect(() => execFileSync(
      process.execPath,
      ['scripts/generate-troubleshooting.mjs', '--check'],
      { cwd: repoRoot, stdio: 'pipe' },
    )).not.toThrow();
  });

  it('requires an actionable symptom-to-verification contract for every entry', () => {
    const catalog = JSON.parse(fs.readFileSync(
      path.join(repoRoot, 'docs/troubleshooting/catalog.json'),
      'utf8',
    )) as { entries: TroubleshootingEntry[] };

    expect(catalog.entries.length).toBeGreaterThanOrEqual(8);
    expect(new Set(catalog.entries.map((entry) => entry.id)).size).toBe(catalog.entries.length);
    for (const entry of catalog.entries) {
      expect(entry.id).toMatch(/^[a-z0-9-]+$/u);
      for (const locale of ['zh', 'en'] as const) {
        expect(entry.title[locale].trim()).not.toBe('');
        expect(entry.symptom[locale].trim()).not.toBe('');
        expect(entry.causes.map((item) => item[locale]).filter(Boolean).length).toBeGreaterThan(0);
        expect(entry.actions.map((item) => item[locale]).filter(Boolean).length).toBeGreaterThan(0);
        expect(entry.verification.map((item) => item[locale]).filter(Boolean).length).toBeGreaterThan(0);
      }
    }
  });

  it('publishes the four-stage workflow in both languages', () => {
    const zh = fs.readFileSync(path.join(repoRoot, 'docs/troubleshooting/index.md'), 'utf8');
    const en = fs.readFileSync(path.join(repoRoot, 'docs/en/troubleshooting/index.md'), 'utf8');
    expect(zh).toContain('症状 → 原因 → 操作 → 验证');
    expect(en).toContain('Symptom → Cause → Action → Verification');
    expect(zh).toContain('id="console-cannot-connect"');
    expect(en).toContain('id="workroom-not-routing"');
  });
});
