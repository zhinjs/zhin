import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  generatePluginCapabilityCodegen,
  scanConventionCapabilityFeatures,
} from '../src/convention-feature-scanner.js';

describe('scanConventionCapabilityFeatures & generatePluginCapabilityCodegen', () => {
  it('discovers nested commands, tools, skills, pages, handlers, and generates static d.ts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-convention-scan-'));
    try {
      await mkdir(join(root, 'commands', 'ping'), { recursive: true });
      await writeFile(join(root, 'commands', 'ping', 'index.ts'), 'export default {};\n');

      await mkdir(join(root, 'commands', 'admin', 'ban'), { recursive: true });
      await writeFile(join(root, 'commands', 'admin', 'ban', 'index.ts'), 'export default {};\n');

      await mkdir(join(root, 'tools', 'lookup'), { recursive: true });
      await writeFile(join(root, 'tools', 'lookup', 'index.ts'), 'export default {};\n');

      await mkdir(join(root, 'skills', 'weather'), { recursive: true });
      await writeFile(join(root, 'skills', 'weather', 'SKILL.md'), '# Weather\n');

      await mkdir(join(root, 'pages', 'dashboard'), { recursive: true });
      await writeFile(join(root, 'pages', 'dashboard', 'index.ts'), 'export default {};\n');

      await mkdir(join(root, 'handlers', 'audit'), { recursive: true });
      await writeFile(join(root, 'handlers', 'audit', 'index.ts'), 'export default {};\n');

      const features = await scanConventionCapabilityFeatures(root);
      expect(features).toEqual({
        commands: ['admin/ban', 'ping'],
        handlers: ['audit'],
        pages: ['dashboard'],
        skills: ['weather'],
        tools: ['lookup'],
      });

      const codegen = await generatePluginCapabilityCodegen(root, { pluginName: 'demo-plugin' });
      expect(codegen.pluginName).toBe('demo-plugin');
      expect(codegen.features).toEqual(features);
      expect(codegen.dts).toContain('export interface DiscoveredPluginCapabilities');
      expect(codegen.dts).toContain('readonly "commands": readonly ["admin/ban", "ping"];');
      expect(codegen.dts).toContain('readonly "tools": readonly ["lookup"];');
      expect(codegen.dts).toContain('readonly "skills": readonly ["weather"];');
      expect(codegen.snippet).toContain('definePluginCapabilityGraph({');
      expect(codegen.snippet).toContain('commands: ["admin/ban", "ping"],');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('discovers progressive-disclosure tools, skills, hooks, promptSections, and resolves pluginName from plugin.ts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-convention-progressive-'));
    try {
      await writeFile(
        join(root, 'plugin.ts'),
        'import { definePlugin } from "zhin.js";\nexport default definePlugin({ name: "my-smart-plugin" });\n',
      );
      await mkdir(join(root, 'skills', 'music', 'tools', 'play-song'), { recursive: true });
      await writeFile(join(root, 'skills', 'music', 'SKILL.md'), '# Music\n');
      await writeFile(join(root, 'skills', 'music', 'tools', 'play-song', 'index.ts'), 'export default {};\n');

      await mkdir(join(root, 'agents', 'reviewer', 'tools', 'diff-check'), { recursive: true });
      await writeFile(join(root, 'agents', 'reviewer', 'agent.json'), '{}\n');
      await writeFile(join(root, 'agents', 'reviewer', 'tools', 'diff-check', 'index.ts'), 'export default {};\n');

      await mkdir(join(root, 'agents', 'reviewer', 'skills', 'security', 'tools', 'cve-scan'), {
        recursive: true,
      });
      await writeFile(join(root, 'agents', 'reviewer', 'skills', 'security', 'SKILL.md'), '# Security\n');
      await writeFile(
        join(root, 'agents', 'reviewer', 'skills', 'security', 'tools', 'cve-scan', 'index.cjs'),
        'module.exports = {};\n',
      );

      await mkdir(join(root, 'prompt-sections', 'persona'), { recursive: true });
      await writeFile(join(root, 'prompt-sections', 'persona', 'index.ts'), 'export default {};\n');

      await mkdir(join(root, 'skills', 'music', 'hooks', 'after-play'), { recursive: true });
      await writeFile(join(root, 'skills', 'music', 'hooks', 'after-play', 'index.ts'), 'export default {};\n');

      const codegen = await generatePluginCapabilityCodegen(root);
      expect(codegen.pluginName).toBe('my-smart-plugin');
      expect(codegen.features).toEqual({
        agents: ['reviewer'],
        hooks: ['skill/music/after-play'],
        promptSections: ['persona'],
        skills: ['agent/reviewer/security', 'music'],
        tools: [
          'agent/reviewer/diff-check',
          'agent/reviewer/skill/security/cve-scan',
          'skill/music/play-song',
        ],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
