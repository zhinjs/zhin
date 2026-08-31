/** Generation-owned Tool / Skill provider integration. */

import type { ToolInvocationContext } from '@zhin.js/tool';
import { SeamProviderRegistry, type SeamScope } from './seam-provider.js';
import type { ToolService, ToolSchema, ToolExecutionResult } from './tool-service.js';
import type {
  SkillService,
  SkillMetadata,
  SkillInvocationResult,
} from './skill-service.js';

export interface ProjectedSeamTool {
  readonly providerId: string;
  readonly schema: ToolSchema;
  execute(input: unknown, context: ToolInvocationContext): Promise<ToolExecutionResult>;
}

export interface ProjectedSeamSkill {
  readonly providerId: string;
  readonly metadata: SkillMetadata & { readonly name: string };
  readonly instructions: string;
}

/**
 * Collects service providers, while leaving execution authority to the
 * canonical TurnToolRuntime. `projectTools()` returns bound definitions; it
 * deliberately does not expose a second, policy-free execute-by-name path.
 */
export class SeamIntegration {
  readonly toolRegistry = new SeamProviderRegistry<ToolService>();
  readonly skillRegistry = new SeamProviderRegistry<SkillService>();

  registerToolService(scope: SeamScope | 'global', service: ToolService): () => void {
    return this.toolRegistry.register(scope, service);
  }

  getToolSchemas(scope: SeamScope | 'global'): ToolSchema[] {
    return this.projectToolSchemas(scope).map(({ schema }) => schema);
  }

  projectTools(scope: SeamScope | 'global'): ProjectedSeamTool[] {
    return this.projectToolSchemas(scope).map(({ service, schema }) => Object.freeze({
      providerId: service.id,
      schema,
      execute: async (input: unknown, context: ToolInvocationContext) => {
        if (service.isAvailable?.(scope, schema.function.name) === false) {
          return { success: false, error: `Tool unavailable: ${schema.function.name}` };
        }
        try {
          await service.applyPolicy?.(scope, schema.function.name, input, context);
          return await service.execute(scope, schema.function.name, input, context);
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }));
  }

  /**
   * @deprecated Direct execution would bypass TurnToolRuntime. This
   * compatibility method always rejects; project the provider through
   * CapabilityIngress and execute the resulting Tool capability.
   */
  async executeTool(
    _scope: SeamScope | 'global',
    toolName: string,
    _args: unknown,
  ): Promise<ToolExecutionResult> {
    return {
      success: false,
      error: `Direct Seam execution is disabled for Tool: ${toolName}`,
    };
  }

  registerSkillService(scope: SeamScope | 'global', service: SkillService): () => void {
    return this.skillRegistry.register(scope, service);
  }

  async getSkillCatalog(scope: SeamScope | 'global'): Promise<SkillMetadata[]> {
    return (await this.projectSkills(scope)).map(({ metadata }) => metadata);
  }

  async projectSkills(scope: SeamScope | 'global'): Promise<ProjectedSeamSkill[]> {
    const projected: ProjectedSeamSkill[] = [];
    const names = new Set<string>();
    for (const service of this.skillRegistry.getFor(scope)) {
      for (const metadata of await service.catalog(scope)) {
        const name = metadata.name?.trim();
        if (!name || service.isAvailable?.(scope, name) === false) continue;
        if (names.has(name)) throw new Error(`Duplicate Seam Skill capability: ${name}`);
        names.add(name);
        projected.push(Object.freeze({
          providerId: service.id,
          metadata: immutableSnapshot({ ...metadata, name }),
          instructions: await service.describe(scope, name),
        }));
      }
    }
    return projected;
  }

  /** @deprecated Skills are declarative; load their instructions and execute Tools. */
  async invokeSkill(
    _scope: SeamScope | 'global',
    skillId: string,
    _input: unknown,
  ): Promise<SkillInvocationResult> {
    return {
      success: false,
      error: `Direct Skill invocation is disabled: ${skillId}`,
    };
  }

  dispose(): void {
    this.toolRegistry.dispose();
    this.skillRegistry.dispose();
  }

  private projectToolSchemas(
    scope: SeamScope | 'global',
  ): Array<{ service: ToolService; schema: ToolSchema }> {
    const projected: Array<{ service: ToolService; schema: ToolSchema }> = [];
    const names = new Set<string>();
    for (const service of this.toolRegistry.getFor(scope)) {
      for (const schema of service.schema(scope)) {
        const name = schema.function.name.trim();
        if (!name || service.isAvailable?.(scope, name) === false) continue;
        if (names.has(name)) throw new Error(`Duplicate Seam Tool capability: ${name}`);
        names.add(name);
        projected.push({
          service,
          schema: immutableSnapshot({
            ...schema,
            function: { ...schema.function, name },
          }),
        });
      }
    }
    return projected;
  }
}

function immutableSnapshot<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => immutableSnapshot(entry))) as T;
  }
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, immutableSnapshot(entry)]),
    )) as T;
  }
  return value;
}
