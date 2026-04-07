/**
 * MessageFilterFeature — 消息过滤引擎
 *
 * 设计理念：
 *   将过滤规则视为 Feature Item，与命令 (CommandFeature)、权限 (PermissionFeature) 同构，
 *   遵循框架的 add/remove/extensions/toJSON 范式，支持插件级 CRUD 和生命周期自动回收。
 *
 * 核心特性：
 *   - 基于优先级的规则引擎（first-match-wins，类似防火墙规则）
 *   - 多维匹配：scope / adapter / bot / channel / sender
 *   - 支持精确匹配、通配符 `*`、正则 `/pattern/`
 *   - 通过 Dispatcher Guardrail 集成，在消息调度第一阶段拦截
 *   - 插件通过 `addFilterRule()` 动态注册规则，卸载时自动清理
 */

import { Feature, FeatureJSON } from '../feature.js';
import { getPlugin } from '../plugin.js';
import type { Message, MessageType } from '../message.js';

// ============================================================================
// 类型定义
// ============================================================================

/** 过滤动作 */
export type FilterAction = 'allow' | 'deny';

/** 匹配模式：精确字符串 / 正则表达式 */
export type FilterPattern = string | RegExp;

/** 消息作用域 */
export type FilterScope = MessageType; // 'private' | 'group' | 'channel'

/**
 * 过滤规则
 *
 * 每条规则描述一组匹配条件和对应的动作。
 * 所有条件之间为 AND 关系（必须全部满足），每个条件内部的多个值为 OR 关系（满足任一即可）。
 * 未设置的条件视为匹配所有。
 *
 * @example
 * // 拒绝特定群的消息
 * { name: 'block-spam', action: 'deny', scopes: ['group'], channels: ['123456'] }
 *
 * // 放行 VIP 用户（高优先级）
 * { name: 'allow-vip', action: 'allow', priority: 100, senders: ['admin001'] }
 *
 * // 正则匹配：拒绝所有 test- 开头的频道
 * { name: 'block-test', action: 'deny', scopes: ['channel'], channels: [/^test-/] }
 */
export interface FilterRule {
  /** 规则名称（唯一标识） */
  name: string;
  /** 规则描述 */
  description?: string;
  /** 过滤动作：allow 放行 / deny 拦截 */
  action: FilterAction;
  /** 优先级，数值越大越先匹配（默认 0） */
  priority?: number;
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 匹配的消息作用域，未设置则匹配所有 */
  scopes?: FilterScope[];
  /** 匹配的适配器名称 */
  adapters?: FilterPattern[];
  /** 匹配的 Bot 名称 */
  bots?: FilterPattern[];
  /** 匹配的频道/群/会话 ID */
  channels?: FilterPattern[];
  /** 匹配的发送者 ID */
  senders?: FilterPattern[];
}

/** 过滤检测结果 */
export interface FilterResult {
  /** 是否允许处理 */
  allowed: boolean;
  /** 匹配到的规则名称（null 表示无规则匹配，走默认策略） */
  matchedRule: string | null;
  /** 结果原因 */
  reason: string;
}

// ---- 配置类型 ----

/** 配置文件中的规则（pattern 均为 string，正则用 /pattern/ 表示） */
export interface FilterRuleConfig {
  name: string;
  description?: string;
  action: FilterAction;
  priority?: number;
  enabled?: boolean;
  scopes?: FilterScope[];
  adapters?: string[];
  bots?: string[];
  channels?: string[];
  senders?: string[];
}

/**
 * 消息过滤配置
 *
 * ```yaml
 * message_filter:
 *   default_policy: allow
 *   rules:
 *     - name: block-spam
 *       action: deny
 *       scopes: [group]
 *       channels: ['123456']
 *     - name: vip-pass
 *       action: allow
 *       priority: 100
 *       senders: ['admin001']
 * ```
 */
export interface MessageFilterConfig {
  /** 默认策略：无规则匹配时的行为（默认 'allow'） */
  default_policy?: FilterAction;
  /** 规则列表 */
  rules?: FilterRuleConfig[];
}

// ============================================================================
// Plugin 扩展声明
// ============================================================================

export interface MessageFilterContextExtensions {
  /** 添加过滤规则，返回 dispose 函数 */
  addFilterRule(rule: FilterRule): () => void;
  /** 检测消息是否应被处理 */
  testFilter(message: Message<any>): FilterResult;
  /** 设置默认过滤策略 */
  setDefaultFilterPolicy(policy: FilterAction): void;
}

declare module '../plugin.js' {
  namespace Plugin {
    interface Extensions extends MessageFilterContextExtensions {}
    interface Contexts {
      'message-filter': MessageFilterFeature;
    }
  }
}

// ============================================================================
// 规则工厂
// ============================================================================

export namespace FilterRules {
  /** 创建拒绝规则 */
  export function deny(name: string, conditions: Omit<FilterRule, 'name' | 'action'>): FilterRule {
    return { ...conditions, name, action: 'deny' };
  }

  /** 创建放行规则 */
  export function allow(name: string, conditions: Omit<FilterRule, 'name' | 'action'>): FilterRule {
    return { ...conditions, name, action: 'allow' };
  }

  /**
   * 创建黑名单规则组
   * @returns 一条 deny 规则
   */
  export function blacklist(
    scope: FilterScope,
    ids: string[],
    name?: string,
  ): FilterRule {
    return {
      name: name ?? `${scope}-blacklist`,
      action: 'deny',
      scopes: [scope],
      channels: ids,
    };
  }

  /**
   * 创建白名单规则组
   * @returns [allow 规则, deny-catch-all 规则]
   */
  export function whitelist(
    scope: FilterScope,
    ids: string[],
    name?: string,
  ): [FilterRule, FilterRule] {
    const baseName = name ?? `${scope}-whitelist`;
    return [
      { name: baseName, action: 'allow', scopes: [scope], channels: ids, priority: 1 },
      { name: `${baseName}-deny-rest`, action: 'deny', scopes: [scope], priority: -100 },
    ];
  }
}

// ============================================================================
// Feature 实现
// ============================================================================

export class MessageFilterFeature extends Feature<FilterRule> {
  readonly name = 'message-filter' as const;
  readonly icon = 'Filter';
  readonly desc = '消息过滤';

  /** 按规则名称索引 */
  readonly byName = new Map<string, FilterRule>();

  #defaultPolicy: FilterAction = 'allow';
  #sortedCache: FilterRule[] | null = null;

  constructor(config?: MessageFilterConfig) {
    super();
    if (config) this.#loadConfig(config);
  }

  // ---- 公共 API ----

  /** 默认策略 */
  get defaultPolicy(): FilterAction { return this.#defaultPolicy; }
  set defaultPolicy(policy: FilterAction) { this.#defaultPolicy = policy; }

  /** 获取按优先级排序的启用规则列表（带缓存） */
  get sortedRules(): FilterRule[] {
    if (!this.#sortedCache) {
      this.#sortedCache = [...this.items]
        .filter(r => r.enabled !== false)
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    }
    return this.#sortedCache;
  }

  /** 按名称查询规则 */
  getRule(name: string): FilterRule | undefined {
    return this.byName.get(name);
  }

  /**
   * 检测消息是否应该被处理
   *
   * 遍历按优先级排序的规则列表，返回第一个匹配的规则结果。
   * 若无规则匹配，按默认策略决定。
   */
  test(message: Message<any>): FilterResult {
    for (const rule of this.sortedRules) {
      if (this.#matchRule(rule, message)) {
        return {
          allowed: rule.action === 'allow',
          matchedRule: rule.name,
          reason: `matched rule "${rule.name}" → ${rule.action}`,
        };
      }
    }
    return {
      allowed: this.#defaultPolicy === 'allow',
      matchedRule: null,
      reason: `no rule matched → default policy: ${this.#defaultPolicy}`,
    };
  }

  // ---- Feature 重写 ----

  /** 添加规则，维护 byName 索引 */
  add(rule: FilterRule, pluginName: string): () => void {
    this.byName.set(rule.name, rule);
    this.#sortedCache = null;
    return super.add(rule, pluginName);
  }

  /** 移除规则，清理 byName 索引 */
  remove(rule: FilterRule, pluginName?: string): boolean {
    this.byName.delete(rule.name);
    this.#sortedCache = null;
    return super.remove(rule, pluginName);
  }

  /** 清理所有规则注册（热重载时由 Plugin.stop() 调用） */
  dispose(): void {
    this.byName.clear();
    this.#sortedCache = null;
  }

  /** 序列化为 JSON（供 Web 控制台展示） */
  toJSON(pluginName?: string): FeatureJSON {
    const list = pluginName ? this.getByPlugin(pluginName) : this.items;
    return {
      name: this.name,
      icon: this.icon,
      desc: this.desc,
      count: list.length,
      items: list.map(r => ({
        name: r.name,
        description: r.description,
        action: r.action,
        priority: r.priority ?? 0,
        enabled: r.enabled !== false,
        scopes: r.scopes,
        adapters: r.adapters?.map(p => p instanceof RegExp ? p.source : p),
        bots: r.bots?.map(p => p instanceof RegExp ? p.source : p),
        channels: r.channels?.map(p => p instanceof RegExp ? p.source : p),
        senders: r.senders?.map(p => p instanceof RegExp ? p.source : p),
      })),
    };
  }

  /** 插件扩展方法 */
  get extensions() {
    const feature = this;
    return {
      addFilterRule(rule: FilterRule) {
        const plugin = getPlugin();
        const dispose = feature.add(rule, plugin.name);
        plugin.recordFeatureContribution(feature.name, rule.name);
        plugin.onDispose(dispose);
        return dispose;
      },
      testFilter(message: Message<any>) {
        return feature.test(message);
      },
      setDefaultFilterPolicy(policy: FilterAction) {
        feature.defaultPolicy = policy;
      },
    };
  }

  // ============================================================================
  // 配置加载
  // ============================================================================

  #loadConfig(config: MessageFilterConfig): void {
    if (config.default_policy) {
      this.#defaultPolicy = config.default_policy;
    }

    if (config.rules) {
      for (const rc of config.rules) {
        this.add(this.#parseRuleConfig(rc), '__config__');
      }
    }
  }

  // ============================================================================
  // 规则匹配
  // ============================================================================

  /** 解析配置中的规则字符串为 FilterPattern */
  #parseRuleConfig(rc: FilterRuleConfig): FilterRule {
    return {
      name: rc.name,
      description: rc.description,
      action: rc.action,
      priority: rc.priority,
      enabled: rc.enabled,
      scopes: rc.scopes,
      adapters: rc.adapters?.map(p => this.#parsePattern(p)),
      bots: rc.bots?.map(p => this.#parsePattern(p)),
      channels: rc.channels?.map(p => this.#parsePattern(p)),
      senders: rc.senders?.map(p => this.#parsePattern(p)),
    };
  }

  /** 解析单个 pattern："/regex/flags" → RegExp，其余为精确字符串 */
  #parsePattern(pattern: string): FilterPattern {
    const match = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
    if (match) {
      return new RegExp(match[1], match[2]);
    }
    return pattern;
  }

  /** 检查规则是否匹配消息（所有条件 AND，条件内 OR） */
  #matchRule(rule: FilterRule, message: Message<any>): boolean {
    if (rule.scopes?.length && !rule.scopes.includes(message.$channel.type as FilterScope)) {
      return false;
    }
    if (rule.adapters?.length && !this.#matchAny(rule.adapters, String(message.$adapter))) {
      return false;
    }
    if (rule.bots?.length && !this.#matchAny(rule.bots, String(message.$bot))) {
      return false;
    }
    if (rule.channels?.length && !this.#matchAny(rule.channels, String(message.$channel.id))) {
      return false;
    }
    if (rule.senders?.length && !this.#matchAny(rule.senders, String(message.$sender.id))) {
      return false;
    }
    return true;
  }

  /** 检查值是否与任一 pattern 匹配 */
  #matchAny(patterns: FilterPattern[], value: string): boolean {
    return patterns.some(p => {
      if (p instanceof RegExp) return p.test(value);
      if (p === '*') return true;
      return p === value;
    });
  }
}
