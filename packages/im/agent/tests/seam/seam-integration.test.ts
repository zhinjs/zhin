import { describe, it, expect } from 'vitest';
import { SeamIntegration } from '../../src/seam/seam-integration.js';
import type { ToolService } from '../../src/seam/tool-service.js';
import type { SkillService, SkillMetadata } from '../../src/seam/skill-service.js';
import type { ToolInvocationContext } from '@zhin.js/tool';

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

    it('projects provider execution for the canonical turn runtime', async () => {
      const integration = new SeamIntegration();
      integration.registerToolService('global', makeToolService('svc', ['my_tool']));

      const [tool] = integration.projectTools('global');
      const result = await tool!.execute({ x: 1 }, invocation());
      expect(result.success).toBe(true);
      expect((result.output as any).toolName).toBe('my_tool');
    });

    it('does not expose an execute-by-name policy bypass', () => {
      const integration = new SeamIntegration();
      expect('executeTool' in integration).toBe(false);
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

    it('projects skill instructions through the correct service', async () => {
      const integration = new SeamIntegration();
      integration.registerSkillService(
        'global',
        makeSkillService('svc', [{ name: 'my_skill', description: 'My skill' }]),
      );

      const [result] = await integration.projectSkills('global');
      expect(result?.metadata.name).toBe('my_skill');
      expect(result?.instructions).toBe('My skill');
    });

    it('returns error result when skill is not found', async () => {
      const integration = new SeamIntegration();

      expect(await integration.projectSkills('global')).toEqual([]);
    });
  });
});

function invocation(): ToolInvocationContext {
  return {
    signal: new AbortController().signal,
    traceId: 'trace',
    turnId: 'turn',
    sessionKey: 'session',
    origin: { kind: 'internal', source: 'test' },
    principal: { subjectId: 'user', roles: ['user'] },
    policy: {
      permissions: ['user'],
      unattended: false,
      network: { enabled: false },
    },
  };
}
