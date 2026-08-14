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

function toKey(scope: SeamScope): string {
  return typeof scope === 'symbol' ? scope.toString() : scope;
}

/**
 * 能力接缝提供者注册表
 *
 * 支持作用域隔离、查询和消费方模式。
 * 'global' 作用域的提供者对所有查询可见。
 */
export class SeamProviderRegistry<T extends SeamProvider> {
  private readonly providers = new Map<string, T[]>();

  /**
   * 在指定作用域下注册一个 Service Provider
   */
  register(scope: SeamScope | 'global', provider: T): void {
    const key = toKey(scope);
    if (!this.providers.has(key)) {
      this.providers.set(key, []);
    }
    this.providers.get(key)!.push(provider);
  }

  /**
   * 获取指定作用域下的所有提供者（包含 global 中的提供者）
   */
  getFor(scope: SeamScope | 'global'): T[] {
    const key = toKey(scope);
    const scoped = this.providers.get(key) ?? [];
    if (key === 'global') return scoped;
    const global = this.providers.get('global') ?? [];
    return [...global, ...scoped];
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
    const key = toKey(scope);
    const list = this.providers.get(key);
    if (!list) return false;
    const idx = list.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    return true;
  }
}
