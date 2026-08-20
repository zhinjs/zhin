import { describe, it, expect } from 'vitest';
import { SeamIntegration } from '../../src/seam/seam-integration.js';
import type { ToolService } from '../../src/seam/tool-service.js';
import type { SkillService, SkillMetadata } from '../../src/seam/skill-service.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeToolService(id: string, toolNames: string[]): ToolService {
  return {
    id,
    description: `Service ${id}`,
    schema: () =>
      toolNames.map((name) => ({
        type: 'function' as const,
        function: { name, description: `Tool ${name}`, parameters: {} },
      })),
    execute: async (_scope, toolName, args) => ({
      success: true,
      output: { toolName, args },
    }),
  };
}

function makeSkillService(id: string, skills: SkillMetadata[]): SkillService {
  return {
    id,
    description: `Skill service ${id}`,
    catalog: async () => skills,
    describe: async (_scope, skillId) => {
      const found = skills.find((s) => s.name === skillId);
      if (!found) throw new Error(`Skill not found: ${skillId}`);
      return found.description;
    },
    invoke: async (_scope, request) => ({ success: true, output: request.input }),
    isAvailable: (_scope, skillId) => skills.some((s) => s.name === skillId),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('SeamIntegration', () => {
  describe('Tool Service', () => {
    it('collects tool schemas from all registered services', () => {
      const integration = new SeamIntegration();

      integration.registerToolService('global', makeToolService('svc-a', ['tool_a1', 'tool_a2']));
      integration.registerToolService('global', makeToolService('svc-b', ['tool_b1']));

      const schemas = integration.getToolSchemas('global');
      expect(schemas).toHaveLength(3);
      expect(schemas.map((s) => s.function.name)).toEqual(
        expect.arrayContaining(['tool_a1', 'tool_a2', 'tool_b1']),
      );
    });

    it('includes global services when querying scoped', () => {
      const integration = new SeamIntegration();

      integration.registerToolService('global', makeToolService('global-svc', ['global_tool']));
      integration.registerToolService('scope-1', makeToolService('scoped-svc', ['scoped_tool']));

      const schemas = integration.getToolSchemas('scope-1');
      expect(schemas.map((s) => s.function.name)).toContain('global_tool');
      expect(schemas.map((s) => s.function.name)).toContain('scoped_tool');
    });

    it('executes a tool through the correct service', async () => {
      const integration = new SeamIntegration();
      integration.registerToolService('global', makeToolService('svc', ['my_tool']));

      const result = await integration.executeTool('global', 'my_tool', { x: 1 });
      expect(result.success).toBe(true);
      expect((result.output as any).toolName).toBe('my_tool');
    });

    it('returns error result when tool is not found', async () => {
      const integration = new SeamIntegration();

      const result = await integration.executeTool('global', 'nonexistent', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Tool not found');
    });

    it('returns empty schemas when no services are registered', () => {
      const integration = new SeamIntegration();
      expect(integration.getToolSchemas('global')).toEqual([]);
    });
  });

  describe('Skill Service', () => {
    it('collects skill catalog from all registered services', async () => {
      const integration = new SeamIntegration();

      integration.registerSkillService(
        'global',
        makeSkillService('svc-a', [
          { name: 'skill_a', description: 'Skill A' },
        ]),
      );
      integration.registerSkillService(
        'global',
        makeSkillService('svc-b', [
          { name: 'skill_b', description: 'Skill B' },
        ]),
      );

      const catalog = await integration.getSkillCatalog('global');
      expect(catalog).toHaveLength(2);
      expect(catalog.map((s) => s.name)).toEqual(
        expect.arrayContaining(['skill_a', 'skill_b']),
      );
    });

    it('invokes a skill through the correct service', async () => {
      const integration = new SeamIntegration();
      integration.registerSkillService(
        'global',
        makeSkillService('svc', [{ name: 'my_skill', description: 'My skill' }]),
      );

      const result = await integration.invokeSkill('global', 'my_skill', { data: 42 });
      expect(result.success).toBe(true);
    });

    it('returns error result when skill is not found', async () => {
      const integration = new SeamIntegration();

      const result = await integration.invokeSkill('global', 'missing_skill', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Skill not found');
    });
  });
});
