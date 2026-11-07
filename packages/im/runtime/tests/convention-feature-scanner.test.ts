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
});
