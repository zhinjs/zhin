/**
 * 能力接缝基类与注册表
 *
 * 所有 Service Provider（LLM / Tool / Skill）必须遵循此约束。
 */

/**
 * 能力接缝提供者基接口
 *
 * 定义所有 Service Provider 必须遵循的约束：
 * 1. 声明身份（id + description）
 * 2. 实现一个主操作接口（如 schema、invoke）
 * 3. 支持作用域隔离（scoped per agent/session）
 */
export interface SeamProvider {
  /**
   * 唯一标识符（建议格式：namespace:name）
   * 例：llm:deepseek, tool:filesystem, skill:github
   */
  readonly id: string;

  /**
   * 人类可读的描述
   */
  readonly description: string;

  /**
   * 可选：该能力的平台/运行时标记
   */
  readonly tags?: string[];

  /**
   * 可选：该能力的版本
   */
  readonly version?: string;
}

export type SeamScope = string | symbol;

/**
 * 能力接缝提供者注册表
 *
 * 支持作用域隔离、查询和消费方模式。
 * 'global' 作用域的提供者对所有查询可见。
 */
export class SeamProviderRegistry<T extends SeamProvider> {
  private readonly providers = new Map<SeamScope | 'global', T[]>();

  /**
   * 在指定作用域下注册一个 Service Provider
   */
  register(scope: SeamScope | 'global', provider: T): () => void {
    const key = scope;
    const providers = this.providers.get(key) ?? [];
    if (providers.some((candidate) => candidate.id === provider.id)) {
      throw new Error(`Duplicate Seam provider "${provider.id}" in scope "${String(key)}"`);
    }
    providers.push(provider);
    this.providers.set(key, providers);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.remove(scope, provider.id);
    };
  }

  /**
   * 获取指定作用域下的所有提供者（包含 global 中的提供者）
   */
  getFor(scope: SeamScope | 'global'): T[] {
    const key = scope;
    const scoped = this.providers.get(key) ?? [];
    if (key === 'global') return [...scoped];
    const global = this.providers.get('global') ?? [];
    const visible = new Map(global.map((provider) => [provider.id, provider]));
    for (const provider of scoped) visible.set(provider.id, provider);
    return [...visible.values()];
  }

  /**
   * 查询满足条件的首个提供者
   */
  find(scope: SeamScope | 'global', predicate: (p: T) => boolean): T | null {
    const providers = this.getFor(scope);
    return providers.find(predicate) ?? null;
  }

  /**
   * 获取指定 ID 的提供者
   */
  getById(scope: SeamScope | 'global', id: string): T | null {
    return this.find(scope, (p) => p.id === id);
  }

  /**
   * 移除已注册的提供者（返回是否实际移除）
   */
  remove(scope: SeamScope | 'global', id: string): boolean {
    const key = scope;
    const list = this.providers.get(key);
    if (!list) return false;
    const idx = list.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    if (list.length === 0) this.providers.delete(key);
    return true;
  }

  dispose(): void {
    this.providers.clear();
  }
}
