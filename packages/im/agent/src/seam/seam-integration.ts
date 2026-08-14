/**
 * 统一的能力接缝集成器
 *
 * 管理 Tool / Skill 两类能力的 Provider Registry，并提供便利方法。
 * 在 ZhinAgent 的作用域中提供，供 Consumer（AgentDispatcher、PromptAssemblyRegistry）使用。
 */

import { SeamProviderRegistry, type SeamScope } from './seam-provider.js';
import type { ToolService, ToolSchema, ToolExecutionResult } from './tool-service.js';
import type {
  SkillService,
  SkillMetadata,
  SkillInvocationResult,
} from './skill-service.js';

export class SeamIntegration {
  readonly toolRegistry = new SeamProviderRegistry<ToolService>();
  readonly skillRegistry = new SeamProviderRegistry<SkillService>();

  // ── Tool ────────────────────────────────────────────────────────────

  /**
   * 在指定作用域下注册一个 Tool Service
   */
  registerToolService(scope: SeamScope | 'global', service: ToolService): void {
    this.toolRegistry.register(scope, service);
  }

  /**
   * 获取指定作用域下的所有 Tool Schema
   *
   * 自动遍历所有注册的 Tool Services，收集 schemas。
   */
  getToolSchemas(scope: SeamScope | 'global'): ToolSchema[] {
    return this.toolRegistry
      .getFor(scope)
      .flatMap((service) => service.schema(scope));
  }

  /**
   * 执行一个工具
   *
   * 自动查找提供该工具的 Service，然后执行。
   */
  async executeTool(
    scope: SeamScope | 'global',
    toolName: string,
    args: unknown,
  ): Promise<ToolExecutionResult> {
    const provider = this.toolRegistry.find(
      scope,
      (service) =>
        service.isAvailable?.(scope, toolName) !== false &&
        service.schema(scope).some((s) => s.function.name === toolName),
    );

    if (!provider) {
      return { success: false, error: `Tool not found: ${toolName}` };
    }

    return provider.execute(scope, toolName, args);
  }

  // ── Skill ────────────────────────────────────────────────────────────

  /**
   * 在指定作用域下注册一个 Skill Service
   */
  registerSkillService(scope: SeamScope | 'global', service: SkillService): void {
    this.skillRegistry.register(scope, service);
  }

  /**
   * 获取指定作用域下的所有 Skill 元数据
   *
   * 自动遍历所有注册的 Skill Services，收集 catalogs。
   */
  async getSkillCatalog(scope: SeamScope | 'global'): Promise<SkillMetadata[]> {
    const results = await Promise.all(
      this.skillRegistry.getFor(scope).map((service) => service.catalog(scope)),
    );
    return results.flat();
  }

  /**
   * 调用一个 Skill
   *
   * 自动查找提供该 Skill 的 Service，然后调用。
   */
  async invokeSkill(
    scope: SeamScope | 'global',
    skillId: string,
    input: unknown,
  ): Promise<SkillInvocationResult> {
    const provider = this.skillRegistry.find(
      scope,
      (service) => service.isAvailable?.(scope, skillId) !== false,
    );

    if (!provider) {
      return { success: false, error: `Skill not found: ${skillId}` };
    }

    return provider.invoke(scope, { skillId, input });
  }
}
