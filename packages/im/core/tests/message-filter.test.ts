/**
 * MessageFilterFeature 测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MessageFilterFeature,
  FilterRules,
  type FilterRule,
  type MessageFilterConfig,
} from '../src/built/message-filter.js';
import type { Message, MessageBase } from '../src/message.js';

// ============================================================================
// 辅助函数
// ============================================================================

function makeMessage(overrides: Partial<MessageBase> = {}): Message<any> {
  return {
    $id: '1',
    $adapter: 'test' as any,
    $bot: 'bot1',
    $content: [],
    $raw: '',
    $sender: { id: 'user1', name: 'User' },
    $channel: { id: 'ch1', type: 'group' },
    $timestamp: Date.now(),
    $reply: vi.fn(),
    $recall: vi.fn(),
    ...overrides,
  } as any;
}

// ============================================================================
// 元数据
// ============================================================================

describe('MessageFilterFeature', () => {
  let filter: MessageFilterFeature;

  beforeEach(() => {
    filter = new MessageFilterFeature();
  });

  it('应有正确的元数据', () => {
    expect(filter.name).toBe('message-filter');
    expect(filter.icon).toBe('Filter');
    expect(filter.desc).toBe('消息过滤');
  });

  it('默认策略为 allow', () => {
    expect(filter.defaultPolicy).toBe('allow');
  });

  it('无规则时所有消息允许通过', () => {
    const result = filter.test(makeMessage());
    expect(result.allowed).toBe(true);
    expect(result.matchedRule).toBeNull();
  });

  // ============================================================================
  // 默认策略
  // ============================================================================

  describe('默认策略', () => {
    it('设置 deny 后无规则匹配时应拒绝', () => {
      filter.defaultPolicy = 'deny';
      const result = filter.test(makeMessage());
      expect(result.allowed).toBe(false);
      expect(result.matchedRule).toBeNull();
      expect(result.reason).toContain('deny');
    });

    it('设置 allow 后无规则匹配时应放行', () => {
      filter.defaultPolicy = 'allow';
      const result = filter.test(makeMessage());
      expect(result.allowed).toBe(true);
    });
  });

  // ============================================================================
  // 规则 CRUD
  // ============================================================================

  describe('规则 CRUD', () => {
    it('add 应注册规则', () => {
      const rule: FilterRule = { name: 'r1', action: 'deny' };
      filter.add(rule, 'test-plugin');

      expect(filter.count).toBe(1);
      expect(filter.getRule('r1')).toBe(rule);
      expect(filter.byName.has('r1')).toBe(true);
    });

    it('add 返回的 dispose 应移除规则', () => {
      const rule: FilterRule = { name: 'r1', action: 'deny' };
      const dispose = filter.add(rule, 'test-plugin');

      dispose();
      expect(filter.count).toBe(0);
      expect(filter.getRule('r1')).toBeUndefined();
    });

    it('remove 应移除规则并清理索引', () => {
      const rule: FilterRule = { name: 'r1', action: 'deny' };
      filter.add(rule, 'test-plugin');

      filter.remove(rule);
      expect(filter.count).toBe(0);
      expect(filter.byName.has('r1')).toBe(false);
    });

    it('getByPlugin 应返回该插件的规则', () => {
      filter.add({ name: 'a', action: 'deny' }, 'plugin-a');
      filter.add({ name: 'b', action: 'deny' }, 'plugin-b');
      filter.add({ name: 'c', action: 'deny' }, 'plugin-a');

      expect(filter.getByPlugin('plugin-a')).toHaveLength(2);
      expect(filter.getByPlugin('plugin-b')).toHaveLength(1);
    });
  });

  // ============================================================================
  // 优先级排序
  // ============================================================================

  describe('优先级排序', () => {
    it('高优先级规则应先匹配', () => {
      filter.add({ name: 'low', action: 'deny', priority: 0 }, 'test');
      filter.add({ name: 'high', action: 'allow', priority: 100 }, 'test');

      const result = filter.test(makeMessage());
      expect(result.matchedRule).toBe('high');
      expect(result.allowed).toBe(true);
    });

    it('相同优先级应按添加顺序', () => {
      filter.add({ name: 'first', action: 'deny' }, 'test');
      filter.add({ name: 'second', action: 'allow' }, 'test');

      const result = filter.test(makeMessage());
      expect(result.matchedRule).toBe('first');
    });

    it('添加/移除规则后缓存应刷新', () => {
      filter.add({ name: 'r1', action: 'deny', priority: 10 }, 'test');
      expect(filter.sortedRules[0].name).toBe('r1');

      const dispose = filter.add({ name: 'r2', action: 'allow', priority: 20 }, 'test');
      expect(filter.sortedRules[0].name).toBe('r2');

      dispose();
      expect(filter.sortedRules[0].name).toBe('r1');
    });
  });

  // ============================================================================
  // enabled 字段
  // ============================================================================

  describe('enabled 字段', () => {
    it('disabled 规则应被跳过', () => {
      filter.add({ name: 'disabled', action: 'deny', enabled: false, priority: 100 }, 'test');
      filter.add({ name: 'enabled', action: 'allow' }, 'test');

      const result = filter.test(makeMessage());
      expect(result.matchedRule).toBe('enabled');
    });

    it('enabled: true 应正常匹配', () => {
      filter.add({ name: 'r1', action: 'deny', enabled: true }, 'test');
      const result = filter.test(makeMessage());
      expect(result.matchedRule).toBe('r1');
    });

    it('未设置 enabled 默认为启用', () => {
      filter.add({ name: 'r1', action: 'deny' }, 'test');
      expect(filter.sortedRules).toHaveLength(1);
    });
  });

  // ============================================================================
  // scope 匹配
  // ============================================================================

  describe('scope 匹配', () => {
    it('scope 匹配时应命中', () => {
      filter.add({ name: 'r1', action: 'deny', scopes: ['group'] }, 'test');

      const msg = makeMessage({ $channel: { id: 'ch1', type: 'group' } });
      expect(filter.test(msg).allowed).toBe(false);
    });

    it('scope 不匹配时应跳过', () => {
      filter.add({ name: 'r1', action: 'deny', scopes: ['private'] }, 'test');

      const msg = makeMessage({ $channel: { id: 'ch1', type: 'group' } });
      expect(filter.test(msg).allowed).toBe(true); // 无规则匹配，走默认 allow
    });

    it('多 scope 匹配任一即可', () => {
      filter.add({ name: 'r1', action: 'deny', scopes: ['group', 'channel'] }, 'test');

      expect(filter.test(makeMessage({ $channel: { id: 'c1', type: 'channel' } })).allowed).toBe(false);
      expect(filter.test(makeMessage({ $channel: { id: 'g1', type: 'group' } })).allowed).toBe(false);
      expect(filter.test(makeMessage({ $channel: { id: 'p1', type: 'private' } })).allowed).toBe(true);
    });

    it('未设置 scope 应匹配所有类型', () => {
      filter.add({ name: 'r1', action: 'deny' }, 'test');

      expect(filter.test(makeMessage({ $channel: { id: 'g1', type: 'group' } })).allowed).toBe(false);
      expect(filter.test(makeMessage({ $channel: { id: 'p1', type: 'private' } })).allowed).toBe(false);
      expect(filter.test(makeMessage({ $channel: { id: 'c1', type: 'channel' } })).allowed).toBe(false);
    });
  });

  // ============================================================================
  // 多维条件匹配
  // ============================================================================

  describe('多维条件匹配', () => {
    it('adapter 匹配', () => {
      filter.add({ name: 'r1', action: 'deny', adapters: ['icqq'] }, 'test');

      expect(filter.test(makeMessage({ $adapter: 'icqq' as any })).allowed).toBe(false);
      expect(filter.test(makeMessage({ $adapter: 'discord' as any })).allowed).toBe(true);
    });

    it('bot 匹配', () => {
      filter.add({ name: 'r1', action: 'deny', bots: ['bot-a'] }, 'test');

      expect(filter.test(makeMessage({ $bot: 'bot-a' })).allowed).toBe(false);
      expect(filter.test(makeMessage({ $bot: 'bot-b' })).allowed).toBe(true);
    });

    it('channel 匹配', () => {
      filter.add({ name: 'r1', action: 'deny', channels: ['group-123'] }, 'test');

      expect(filter.test(makeMessage({ $channel: { id: 'group-123', type: 'group' } })).allowed).toBe(false);
      expect(filter.test(makeMessage({ $channel: { id: 'group-456', type: 'group' } })).allowed).toBe(true);
    });

    it('sender 匹配', () => {
      filter.add({ name: 'r1', action: 'deny', senders: ['baduser'] }, 'test');

      expect(filter.test(makeMessage({ $sender: { id: 'baduser', name: 'Bad' } })).allowed).toBe(false);
      expect(filter.test(makeMessage({ $sender: { id: 'gooduser', name: 'Good' } })).allowed).toBe(true);
    });

    it('AND 逻辑：所有条件必须同时满足', () => {
      filter.add({
        name: 'r1',
        action: 'deny',
        scopes: ['group'],
        adapters: ['icqq'],
        senders: ['spammer'],
      }, 'test');

      // 全部满足 → deny
      expect(filter.test(makeMessage({
        $adapter: 'icqq' as any,
        $channel: { id: 'g1', type: 'group' },
        $sender: { id: 'spammer', name: 'S' },
      })).allowed).toBe(false);

      // scope 不满足 → 跳过规则
      expect(filter.test(makeMessage({
        $adapter: 'icqq' as any,
        $channel: { id: 'p1', type: 'private' },
        $sender: { id: 'spammer', name: 'S' },
      })).allowed).toBe(true);

      // adapter 不满足 → 跳过规则
      expect(filter.test(makeMessage({
        $adapter: 'discord' as any,
        $channel: { id: 'g1', type: 'group' },
        $sender: { id: 'spammer', name: 'S' },
      })).allowed).toBe(true);

      // sender 不满足 → 跳过规则
      expect(filter.test(makeMessage({
        $adapter: 'icqq' as any,
        $channel: { id: 'g1', type: 'group' },
        $sender: { id: 'normal', name: 'N' },
      })).allowed).toBe(true);
    });

    it('OR 逻辑：条件内多个值匹配任一', () => {
      filter.add({ name: 'r1', action: 'deny', channels: ['g1', 'g2', 'g3'] }, 'test');

      expect(filter.test(makeMessage({ $channel: { id: 'g1', type: 'group' } })).allowed).toBe(false);
      expect(filter.test(makeMessage({ $channel: { id: 'g2', type: 'group' } })).allowed).toBe(false);
      expect(filter.test(makeMessage({ $channel: { id: 'g4', type: 'group' } })).allowed).toBe(true);
    });
  });

  // ============================================================================
  // Pattern 匹配
  // ============================================================================

  describe('Pattern 匹配', () => {
    it('精确字符串匹配', () => {
      filter.add({ name: 'r1', action: 'deny', channels: ['exact-id'] }, 'test');
      expect(filter.test(makeMessage({ $channel: { id: 'exact-id', type: 'group' } })).allowed).toBe(false);
      expect(filter.test(makeMessage({ $channel: { id: 'exact-id-extra', type: 'group' } })).allowed).toBe(true);
    });

    it('通配符 * 匹配所有', () => {
      filter.add({ name: 'r1', action: 'deny', scopes: ['group'], channels: ['*'] }, 'test');
      expect(filter.test(makeMessage({ $channel: { id: 'any-id', type: 'group' } })).allowed).toBe(false);
      expect(filter.test(makeMessage({ $channel: { id: 'another', type: 'group' } })).allowed).toBe(false);
    });

    it('正则表达式匹配', () => {
      filter.add({ name: 'r1', action: 'deny', channels: [/^test-/] }, 'test');
      expect(filter.test(makeMessage({ $channel: { id: 'test-abc', type: 'group' } })).allowed).toBe(false);
      expect(filter.test(makeMessage({ $channel: { id: 'prod-abc', type: 'group' } })).allowed).toBe(true);
    });

    it('混合 pattern 类型', () => {
      filter.add({ name: 'r1', action: 'deny', senders: ['exact-user', /^bot-/] }, 'test');
      expect(filter.test(makeMessage({ $sender: { id: 'exact-user', name: 'U' } })).allowed).toBe(false);
      expect(filter.test(makeMessage({ $sender: { id: 'bot-123', name: 'B' } })).allowed).toBe(false);
      expect(filter.test(makeMessage({ $sender: { id: 'normal', name: 'N' } })).allowed).toBe(true);
    });
  });

  // ============================================================================
  // first-match-wins 语义
  // ============================================================================

  describe('first-match-wins', () => {
    it('高优先级 allow 应覆盖低优先级 deny', () => {
      filter.add({ name: 'deny-all', action: 'deny', priority: 0 }, 'test');
      filter.add({ name: 'allow-vip', action: 'allow', priority: 100, senders: ['vip'] }, 'test');

      const vipMsg = makeMessage({ $sender: { id: 'vip', name: 'VIP' } });
      const normalMsg = makeMessage({ $sender: { id: 'normal', name: 'N' } });

      expect(filter.test(vipMsg).allowed).toBe(true);
      expect(filter.test(vipMsg).matchedRule).toBe('allow-vip');

      expect(filter.test(normalMsg).allowed).toBe(false);
      expect(filter.test(normalMsg).matchedRule).toBe('deny-all');
    });

    it('白名单模式：allow 特定 + deny 兜底', () => {
      filter.add({ name: 'allow-group', action: 'allow', scopes: ['group'], channels: ['allowed-group'], priority: 1 }, 'test');
      filter.add({ name: 'deny-rest', action: 'deny', scopes: ['group'], priority: -100 }, 'test');

      expect(filter.test(makeMessage({ $channel: { id: 'allowed-group', type: 'group' } })).allowed).toBe(true);
      expect(filter.test(makeMessage({ $channel: { id: 'other-group', type: 'group' } })).allowed).toBe(false);
      // private 消息不受影响
      expect(filter.test(makeMessage({ $channel: { id: 'p1', type: 'private' } })).allowed).toBe(true);
    });
  });

  // ============================================================================
  // 配置加载
  // ============================================================================

  describe('配置加载', () => {
    it('从 config 加载 default_policy', () => {
      const f = new MessageFilterFeature({ default_policy: 'deny' });
      expect(f.defaultPolicy).toBe('deny');
    });

    it('从 config 加载规则', () => {
      const config: MessageFilterConfig = {
        rules: [
          { name: 'r1', action: 'deny', scopes: ['group'], channels: ['123'] },
          { name: 'r2', action: 'allow', priority: 10, senders: ['admin'] },
        ],
      };
      const f = new MessageFilterFeature(config);

      expect(f.count).toBe(2);
      expect(f.getRule('r1')).toBeDefined();
      expect(f.getRule('r2')).toBeDefined();
    });

    it('配置中的正则字符串应被解析', () => {
      const config: MessageFilterConfig = {
        rules: [
          { name: 'regex-rule', action: 'deny', channels: ['/^test-/i'] },
        ],
      };
      const f = new MessageFilterFeature(config);

      expect(f.test(makeMessage({ $channel: { id: 'Test-123', type: 'group' } })).allowed).toBe(false);
      expect(f.test(makeMessage({ $channel: { id: 'prod-123', type: 'group' } })).allowed).toBe(true);
    });

    it('配置中的普通字符串不应被误解析为正则', () => {
      const config: MessageFilterConfig = {
        rules: [
          { name: 'str-rule', action: 'deny', channels: ['plain-string'] },
        ],
      };
      const f = new MessageFilterFeature(config);

      expect(f.test(makeMessage({ $channel: { id: 'plain-string', type: 'group' } })).allowed).toBe(false);
      expect(f.test(makeMessage({ $channel: { id: 'plain-string-extra', type: 'group' } })).allowed).toBe(true);
    });

    it('空 config 应无规则', () => {
      const f = new MessageFilterFeature({});
      expect(f.count).toBe(0);
      expect(f.defaultPolicy).toBe('allow');
    });

    it('undefined config 应无规则', () => {
      const f = new MessageFilterFeature(undefined);
      expect(f.count).toBe(0);
    });
  });

  // ============================================================================
  // FilterRules 工厂
  // ============================================================================

  describe('FilterRules 工厂', () => {
    it('deny() 创建 deny 规则', () => {
      const rule = FilterRules.deny('test-deny', { scopes: ['group'], channels: ['g1'] });
      expect(rule.name).toBe('test-deny');
      expect(rule.action).toBe('deny');
      expect(rule.scopes).toEqual(['group']);
    });

    it('allow() 创建 allow 规则', () => {
      const rule = FilterRules.allow('test-allow', { senders: ['admin'] });
      expect(rule.name).toBe('test-allow');
      expect(rule.action).toBe('allow');
    });

    it('blacklist() 创建 deny 规则', () => {
      const rule = FilterRules.blacklist('group', ['g1', 'g2']);
      expect(rule.action).toBe('deny');
      expect(rule.scopes).toEqual(['group']);
      expect(rule.channels).toEqual(['g1', 'g2']);
      expect(rule.name).toBe('group-blacklist');
    });

    it('blacklist() 支持自定义名称', () => {
      const rule = FilterRules.blacklist('private', ['u1'], 'custom-name');
      expect(rule.name).toBe('custom-name');
    });

    it('whitelist() 创建 [allow, deny-catch-all] 规则对', () => {
      const [allow, deny] = FilterRules.whitelist('channel', ['c1', 'c2']);
      expect(allow.action).toBe('allow');
      expect(allow.scopes).toEqual(['channel']);
      expect(allow.channels).toEqual(['c1', 'c2']);
      expect(allow.priority).toBe(1);

      expect(deny.action).toBe('deny');
      expect(deny.scopes).toEqual(['channel']);
      expect(deny.priority).toBe(-100);
    });

    it('whitelist 集成到 filter 的完整行为', () => {
      const [allow, denyRest] = FilterRules.whitelist('group', ['allowed-group']);
      filter.add(allow, 'test');
      filter.add(denyRest, 'test');

      expect(filter.test(makeMessage({ $channel: { id: 'allowed-group', type: 'group' } })).allowed).toBe(true);
      expect(filter.test(makeMessage({ $channel: { id: 'other-group', type: 'group' } })).allowed).toBe(false);
      expect(filter.test(makeMessage({ $channel: { id: 'p1', type: 'private' } })).allowed).toBe(true);
    });
  });

  // ============================================================================
  // toJSON
  // ============================================================================

  describe('toJSON', () => {
    it('应序列化所有规则', () => {
      filter.add({ name: 'r1', action: 'deny', channels: ['ch1'] }, 'p1');
      filter.add({ name: 'r2', action: 'allow', senders: [/^admin/], priority: 10 }, 'p2');

      const json = filter.toJSON();
      expect(json.name).toBe('message-filter');
      expect(json.count).toBe(2);
      expect(json.items).toHaveLength(2);
    });

    it('应按插件名过滤', () => {
      filter.add({ name: 'r1', action: 'deny' }, 'p1');
      filter.add({ name: 'r2', action: 'deny' }, 'p2');

      expect(filter.toJSON('p1').count).toBe(1);
      expect(filter.toJSON('p1').items[0].name).toBe('r1');
    });

    it('RegExp 应被序列化为 source 字符串', () => {
      filter.add({ name: 'r1', action: 'deny', channels: [/^test-/] }, 'test');
      const json = filter.toJSON();
      expect(json.items[0].channels).toEqual(['^test-']);
    });

    it('字符串 pattern 应保持原样', () => {
      filter.add({ name: 'r1', action: 'deny', channels: ['exact'] }, 'test');
      const json = filter.toJSON();
      expect(json.items[0].channels).toEqual(['exact']);
    });
  });

  // ============================================================================
  // 综合场景
  // ============================================================================

  describe('综合场景', () => {
    it('防火墙规则链：VIP 放行 + 群黑名单 + 默认 allow', () => {
      filter.add({ name: 'vip', action: 'allow', priority: 100, senders: ['vip-user'] }, 'test');
      filter.add({ name: 'block-groups', action: 'deny', scopes: ['group'], channels: ['spam-group'] }, 'test');

      // VIP 即使在黑名单群也能通过
      expect(filter.test(makeMessage({
        $sender: { id: 'vip-user', name: 'V' },
        $channel: { id: 'spam-group', type: 'group' },
      })).allowed).toBe(true);

      // 普通用户在黑名单群被拦截
      expect(filter.test(makeMessage({
        $sender: { id: 'normal', name: 'N' },
        $channel: { id: 'spam-group', type: 'group' },
      })).allowed).toBe(false);

      // 普通用户在正常群通过
      expect(filter.test(makeMessage({
        $sender: { id: 'normal', name: 'N' },
        $channel: { id: 'good-group', type: 'group' },
      })).allowed).toBe(true);
    });

    it('纯白名单模式：default deny + 特定规则放行', () => {
      filter.defaultPolicy = 'deny';
      filter.add({ name: 'allow-admin', action: 'allow', senders: ['admin'] }, 'test');
      filter.add({ name: 'allow-work', action: 'allow', scopes: ['group'], channels: ['work-group'] }, 'test');

      expect(filter.test(makeMessage({ $sender: { id: 'admin', name: 'A' } })).allowed).toBe(true);
      expect(filter.test(makeMessage({ $channel: { id: 'work-group', type: 'group' } })).allowed).toBe(true);
      expect(filter.test(makeMessage({ $channel: { id: 'random-group', type: 'group' } })).allowed).toBe(false);
      expect(filter.test(makeMessage({ $channel: { id: 'p1', type: 'private' } })).allowed).toBe(false);
    });

    it('多适配器隔离：只允许 QQ 群聊，拒绝 QQ 私聊', () => {
      filter.add({ name: 'deny-qq-private', action: 'deny', adapters: ['icqq'], scopes: ['private'] }, 'test');

      expect(filter.test(makeMessage({
        $adapter: 'icqq' as any,
        $channel: { id: 'p1', type: 'private' },
      })).allowed).toBe(false);

      expect(filter.test(makeMessage({
        $adapter: 'icqq' as any,
        $channel: { id: 'g1', type: 'group' },
      })).allowed).toBe(true);

      expect(filter.test(makeMessage({
        $adapter: 'discord' as any,
        $channel: { id: 'p1', type: 'private' },
      })).allowed).toBe(true);
    });
  });
});
