/**
 * AI Trigger 工具函数测试
 * 
 * 测试内容：
 * 1. 前缀触发检测
 * 2. @机器人触发检测
 * 3. 私聊直接对话检测
 * 4. 关键词触发检测
 * 5. 忽略前缀检测
 * 6. 权限推断
 */
import { describe, it, expect, vi } from 'vitest';
import {
  shouldTriggerAI,
  mergeAITriggerConfig,
  resolveSenderRoles,
  resolveIMSessionIdFromMessage,
  parseRichMediaContent,
  DEFAULT_AI_TRIGGER_CONFIG,
  type AITriggerConfig,
} from '@zhin.js/core';

// 创建模拟消息
function createMockMessage(options: {
  content: string | any[];
  endpoint?: string;
  channelType?: 'private' | 'group' | 'channel';
  senderId?: string;
  senderPermissions?: string[];
  senderRole?: string;
}) {
  const content = typeof options.content === 'string' 
    ? [{ type: 'text', data: { text: options.content } }]
    : options.content;
  
  return {
    $content: content,
    $endpoint: options.endpoint || 'bot123',
    $channel: options.channelType ? { type: options.channelType, id: 'channel1' } : null,
    $sender: { 
      id: options.senderId || 'user1', 
      permissions: options.senderPermissions || [],
      role: options.senderRole,
    },
    $adapter: 'test',
    $reply: vi.fn(),
  };
}

describe('AI Trigger 工具函数', () => {
  describe('shouldTriggerAI - 前缀触发', () => {
    it('应该检测 # 前缀', () => {
      const message = createMockMessage({ content: '# 你好' });
      const result = shouldTriggerAI(message as any, { prefixes: ['#'] });
      
      expect(result.triggered).toBe(true);
      expect(result.content).toBe('你好');
    });

    it('应该检测 AI: 前缀', () => {
      const message = createMockMessage({ content: 'AI:帮我计算' });
      const result = shouldTriggerAI(message as any, { prefixes: ['AI:', 'ai:'] });
      
      expect(result.triggered).toBe(true);
      expect(result.content).toBe('帮我计算');
    });

    it('应该检测小写 ai: 前缀', () => {
      const message = createMockMessage({ content: 'ai:今天天气' });
      const result = shouldTriggerAI(message as any, { prefixes: ['AI:', 'ai:'] });
      
      expect(result.triggered).toBe(true);
      expect(result.content).toBe('今天天气');
    });

    it('没有匹配前缀时不应触发', () => {
      const message = createMockMessage({ content: '普通消息' });
      const result = shouldTriggerAI(message as any, { prefixes: ['#'] });
      
      expect(result.triggered).toBe(false);
    });
  });

  describe('shouldTriggerAI - 忽略前缀', () => {
    it('应该忽略命令前缀 /', () => {
      const message = createMockMessage({ 
        content: '/help',
        channelType: 'private',
      });
      const result = shouldTriggerAI(message as any, { 
        prefixes: ['#'],
        ignorePrefixes: ['/'],
        respondToPrivate: true,
      });
      
      expect(result.triggered).toBe(false);
    });

    it('应该忽略命令前缀 !', () => {
      const message = createMockMessage({ 
        content: '!command',
        channelType: 'private',
      });
      const result = shouldTriggerAI(message as any, { 
        prefixes: ['#'],
        ignorePrefixes: ['!', '！'],
        respondToPrivate: true,
      });
      
      expect(result.triggered).toBe(false);
    });
  });

  describe('shouldTriggerAI - 群/频道仅 @ 触发', () => {
    it('群聊 # 前缀不触发 AI（旁听由 session 被动写入）', () => {
      const message = createMockMessage({
        content: '# 你好',
        channelType: 'group',
        channelId: 'g1',
      });
      const result = shouldTriggerAI(message as any, { prefixes: ['#'], respondToAt: true });
      expect(result.triggered).toBe(false);
    });

    it('群聊 @ 仍触发 AI', () => {
      const message = createMockMessage({
        content: [
          { type: 'at', data: { user_id: 'bot123' } },
          { type: 'text', data: { text: ' 问题' } },
        ],
        endpoint: 'bot123',
        channelType: 'group',
        channelId: 'g1',
      });
      const result = shouldTriggerAI(message as any, { prefixes: ['#'], respondToAt: true });
      expect(result.triggered).toBe(true);
      expect(result.content).toBe('问题');
    });
  });

  describe('shouldTriggerAI - 群/频道仅 @ 触发', () => {
    it('群聊 # 前缀不触发 AI（旁听由 session 被动写入）', () => {
      const message = createMockMessage({
        content: '# 你好',
        channelType: 'group',
        channelId: 'g1',
      });
      const result = shouldTriggerAI(message as any, { prefixes: ['#'], respondToAt: true });
      expect(result.triggered).toBe(false);
    });

    it('群聊 @ 仍触发 AI', () => {
      const message = createMockMessage({
        content: [
          { type: 'at', data: { user_id: 'bot123' } },
          { type: 'text', data: { text: ' 问题' } },
        ],
        endpoint: 'bot123',
        channelType: 'group',
        channelId: 'g1',
      });
      const result = shouldTriggerAI(message as any, { prefixes: ['#'], respondToAt: true });
      expect(result.triggered).toBe(true);
      expect(result.content).toBe('问题');
    });
  });

  describe('shouldTriggerAI - @机器人触发', () => {
    it('应该检测 @机器人', () => {
      const message = createMockMessage({
        content: [
          { type: 'at', data: { user_id: 'bot123' } },
          { type: 'text', data: { text: ' 你好呀' } },
        ],
        endpoint: 'bot123',
      });
      const result = shouldTriggerAI(message as any, { respondToAt: true });
      
      expect(result.triggered).toBe(true);
      expect(result.content).toBe('你好呀');
    });

    it('关闭 respondToAt 时不应触发', () => {
      const message = createMockMessage({
        content: [
          { type: 'at', data: { user_id: 'bot123' } },
          { type: 'text', data: { text: ' 你好' } },
        ],
        endpoint: 'bot123',
      });
      const result = shouldTriggerAI(message as any, { respondToAt: false });
      
      expect(result.triggered).toBe(false);
    });

    it('@其他人时不应触发', () => {
      const message = createMockMessage({
        content: [
          { type: 'at', data: { user_id: 'other_user' } },
          { type: 'text', data: { text: ' 你好' } },
        ],
        endpoint: 'bot123',
      });
      const result = shouldTriggerAI(message as any, { respondToAt: true });
      
      expect(result.triggered).toBe(false);
    });

    it('icqq 风格 @（data.qq）应触发', () => {
      const message = createMockMessage({
        content: [
          { type: 'at', data: { qq: '8596238' } },
          { type: 'text', data: { text: ' 你好' } },
        ],
        endpoint: '8596238',
      });
      const result = shouldTriggerAI(message as any, { respondToAt: true });

      expect(result.triggered).toBe(true);
      expect(result.content).toBe('你好');
    });

    it('仅 @ 机器人无正文也应触发', () => {
      const message = createMockMessage({
        content: [{ type: 'at', data: { qq: '8596238' } }],
        endpoint: '8596238',
      });
      const result = shouldTriggerAI(message as any, { respondToAt: true });

      expect(result.triggered).toBe(true);
      expect(result.content).toBe('');
    });

    it('QQ 官方 mention 段应通过 endpointAtIds 匹配', () => {
      const message = createMockMessage({
        content: [
          { type: 'mention', data: { user_id: '900000001' } },
          { type: 'text', data: { text: ' 在吗' } },
        ],
        endpoint: 'zhin2号',
      });
      const result = shouldTriggerAI(message as any, { respondToAt: true }, {
        endpointAtIds: ['zhin2号', '900000001'],
      });

      expect(result.triggered).toBe(true);
      expect(result.content).toBe('在吗');
    });

    it('纯文本 @ 号（无 at 段）应触发', () => {
      const message = createMockMessage({
        content: [{ type: 'text', data: { text: '@8596238 帮忙查一下' } }],
        endpoint: '8596238',
      });
      const result = shouldTriggerAI(message as any, { respondToAt: true });

      expect(result.triggered).toBe(true);
      expect(result.content).toBe('帮忙查一下');
    });
  });

  describe('shouldTriggerAI - 私聊直接对话', () => {
    it('私聊应该直接触发', () => {
      const message = createMockMessage({
        content: '你好',
        channelType: 'private',
      });
      const result = shouldTriggerAI(message as any, { respondToPrivate: true });
      
      expect(result.triggered).toBe(true);
      expect(result.content).toBe('你好');
    });

    it('关闭 respondToPrivate 时私聊不应触发', () => {
      const message = createMockMessage({
        content: '你好',
        channelType: 'private',
      });
      const result = shouldTriggerAI(message as any, { respondToPrivate: false });
      
      expect(result.triggered).toBe(false);
    });

    it('群聊时不应直接触发（需要前缀或@）', () => {
      const message = createMockMessage({
        content: '你好',
        channelType: 'group',
      });
      const result = shouldTriggerAI(message as any, { respondToPrivate: true });
      
      expect(result.triggered).toBe(false);
    });
  });

  describe('shouldTriggerAI - 关键词触发', () => {
    it('应该检测关键词', () => {
      const message = createMockMessage({ content: '今天天气怎么样' });
      const result = shouldTriggerAI(message as any, { keywords: ['天气', '新闻'] });
      
      expect(result.triggered).toBe(true);
      expect(result.content).toBe('今天天气怎么样');
    });

    it('关键词不区分大小写', () => {
      const message = createMockMessage({ content: '说 hello 世界' });
      const result = shouldTriggerAI(message as any, { keywords: ['HELLO'] });
      
      expect(result.triggered).toBe(true);
    });

    it('没有关键词配置时不应触发', () => {
      const message = createMockMessage({ content: '天气真好' });
      const result = shouldTriggerAI(message as any, { keywords: [] });
      
      expect(result.triggered).toBe(false);
    });
  });

  describe('shouldTriggerAI - 禁用状态', () => {
    it('enabled 为 false 时不应触发', () => {
      const message = createMockMessage({ content: '# 你好' });
      const result = shouldTriggerAI(message as any, { 
        enabled: false,
        prefixes: ['#'],
      });
      
      expect(result.triggered).toBe(false);
    });
  });

  describe('触发优先级', () => {
    it('前缀触发应该优先于私聊触发', () => {
      const message = createMockMessage({ 
        content: '# 命令内容',
        channelType: 'private',
      });
      const result = shouldTriggerAI(message as any, { 
        prefixes: ['#'],
        respondToPrivate: true,
      });
      
      expect(result.triggered).toBe(true);
      expect(result.content).toBe('命令内容'); // 应该去掉前缀
    });
  });

  describe('边界情况', () => {
    it('空消息不应触发', () => {
      const message = createMockMessage({ 
        content: '',
        channelType: 'private',
      });
      const result = shouldTriggerAI(message as any, { respondToPrivate: true });
      
      expect(result.triggered).toBe(false);
    });

    it('只有空格的消息不应触发', () => {
      const message = createMockMessage({ 
        content: '   ',
        channelType: 'private',
      });
      const result = shouldTriggerAI(message as any, { respondToPrivate: true });
      
      expect(result.triggered).toBe(false);
    });

    it('前缀后没有内容时应该触发但内容为空', () => {
      const message = createMockMessage({ content: '#' });
      const result = shouldTriggerAI(message as any, { prefixes: ['#'] });
      
      expect(result.triggered).toBe(true);
      expect(result.content).toBe('');
    });
  });

  describe('mergeAITriggerConfig', () => {
    it('应该合并配置', () => {
      const config = mergeAITriggerConfig({ prefixes: ['##'] });
      
      expect(config.prefixes).toEqual(['##']);
      expect(config.enabled).toBe(true);
      expect(config.respondToAt).toBe(true);
    });

    it('应该使用默认值', () => {
      const config = mergeAITriggerConfig({});
      
      expect(config).toEqual(DEFAULT_AI_TRIGGER_CONFIG);
    });
  });

  describe('resolveSenderRoles', () => {
    it('应该解析 master 角色', () => {
      const message = createMockMessage({
        content: 'test',
        senderId: 'master1',
      });
      const result = resolveSenderRoles(message as any, { masters: ['master1'] });
      expect(result.roles).toContain('master');
    });

    it('应该解析 trusted 角色', () => {
      const message = createMockMessage({
        content: 'test',
        senderId: 'admin1',
      });
      const result = resolveSenderRoles(message as any, { trusted: ['admin1'] });
      expect(result.roles).toContain('trusted');
      expect(result.roles).not.toContain('master');
    });

    it('群 owner 权限不推导 scene_owner（走 platform permit）', () => {
      const message = createMockMessage({
        content: 'test',
        senderPermissions: ['owner'],
      });
      const result = resolveSenderRoles(message as any, {});
      expect(result.roles).toEqual(['user']);
    });

    it('群 admin 权限不推导 scene_admin（走 platform permit）', () => {
      const message = createMockMessage({
        content: 'test',
        senderPermissions: ['admin'],
      });
      const result = resolveSenderRoles(message as any, {});
      expect(result.roles).toEqual(['user']);
    });

    it('默认应该是 user 角色', () => {
      const message = createMockMessage({ content: 'test' });
      const result = resolveSenderRoles(message as any, {});
      expect(result.roles).toEqual(['user']);
    });

    it('应该推断 scope', () => {
      const privateMsg = createMockMessage({ content: 'test', channelType: 'private' });
      const groupMsg = createMockMessage({ content: 'test', channelType: 'group' });
      expect(resolveSenderRoles(privateMsg as any, {}).scope).toBe('private');
      expect(resolveSenderRoles(groupMsg as any, {}).scope).toBe('group');
    });

    it('endpoints[].master 应赋予 master', () => {
      const message = createMockMessage({ content: 'hi', senderId: 'qq111' });
      const result = resolveSenderRoles(message as any, {}, { master: 'qq111' });
      expect(result.roles).toContain('master');
    });

    it('endpoints[].trusted 应赋予 trusted（群内可为普通成员）', () => {
      const message = createMockMessage({
        content: 'hi',
        senderId: 'adminQQ',
        channelType: 'group',
      });
      const result = resolveSenderRoles(message as any, {}, { trusted: ['adminQQ'] });
      expect(result.roles).toContain('trusted');
      expect(result.roles).not.toContain('master');
    });

    it('bot master 不因群管权限额外推导 scene_admin', () => {
      const message = createMockMessage({
        content: 'hi',
        senderId: 'ownerQQ',
        channelType: 'group',
        senderPermissions: ['admin'],
      });
      const result = resolveSenderRoles(message as any, {}, { master: 'ownerQQ' });
      expect(result.roles).toContain('master');
      expect(result.roles).toEqual(['master']);
    });

    it('process 适配器发送者应恒为 master', () => {
      const message = createMockMessage({ content: 'hi', senderId: 'cli-user' });
      (message as { $adapter: string }).$adapter = 'process';
      const result = resolveSenderRoles(message as any, {});
      expect(result.roles).toEqual(['master']);
    });
  });

  describe('resolveIMSessionIdFromMessage', () => {
    it('群聊：不同 sender 共享同一 sessionId', () => {
      const u1 = createMockMessage({ content: 'a', channelType: 'group', senderId: 'u1' });
      const u2 = createMockMessage({ content: 'b', channelType: 'group', senderId: 'u2' });
      expect(resolveIMSessionIdFromMessage(u1 as any)).toBe('test:bot123:group:channel1');
      expect(resolveIMSessionIdFromMessage(u2 as any)).toBe(resolveIMSessionIdFromMessage(u1 as any));
    });

    it('私聊：按 sender 区分', () => {
      const msg = createMockMessage({ content: 'hi', channelType: 'private', senderId: 'userA' });
      expect(resolveIMSessionIdFromMessage(msg as any)).toBe('test:bot123:private:userA');
    });
  });

  describe('parseRichMediaContent', () => {
    it('应该解析纯文本', () => {
      const result = parseRichMediaContent('Hello World');
      
      expect(result.length).toBeGreaterThan(0);
      const textElement = result.find(el => el.type === 'text');
      expect(textElement?.data?.text).toContain('Hello');
    });

    it('应该处理 XML 标签', () => {
      const result = parseRichMediaContent('文本<image url="test.jpg"/>');
      
      expect(result.length).toBeGreaterThan(0);
    });

    it('应该处理空字符串', () => {
      const result = parseRichMediaContent('');
      
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
