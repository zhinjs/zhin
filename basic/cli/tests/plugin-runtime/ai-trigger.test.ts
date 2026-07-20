import { describe, expect, it } from 'vitest';
import { Message } from '@zhin.js/core/runtime';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import type { AITriggerConfig } from '@zhin.js/core';
import { matchAiTrigger } from '../../src/plugin-runtime/agent-host-installer.js';

const adapter = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'icqq');

function makeMessage(input: {
  content: string;
  target?: string;
  metadata?: Record<string, unknown>;
}): Message {
  return new Message(
    adapter,
    input.target ?? 'group:100',
    input.content,
    1,
    async () => undefined,
    'm1',
    'user-1',
    Object.freeze(input.metadata ?? {}),
  );
}

function groupMessage(content: string, metadata?: Record<string, unknown>): Message {
  return makeMessage({ content, target: 'group:100', metadata: { channelType: 'group', ...metadata } });
}

function privateMessage(content: string, metadata?: Record<string, unknown>): Message {
  return makeMessage({ content, target: 'private:2', metadata: { channelType: 'private', ...metadata } });
}

describe('matchAiTrigger（新 Plugin Runtime，对齐 legacy shouldTriggerAI）', () => {
  it('enabled=false 不触发', () => {
    expect(matchAiTrigger(privateMessage('hi'), { enabled: false })).toBeNull();
  });

  it('群聊 @ 机器人（metadata.mentioned）触发并剥离 CQ at', () => {
    const msg = groupMessage('[CQ:at,qq=10001] 在吗', { mentioned: true });
    expect(matchAiTrigger(msg, undefined)).toEqual({ content: '在吗' });
  });

  it('群聊仅 @ 无正文（剥离后为空）也触发', () => {
    const msg = groupMessage('[CQ:at,qq=10001]', { mentioned: true });
    expect(matchAiTrigger(msg, undefined)).toEqual({ content: '' });
  });

  it('群聊 @ 触发剥离 QQ 官方/Slack 的 <@!id> 形态', () => {
    const msg = groupMessage('<@!10001> 讲个笑话', { mentioned: true });
    expect(matchAiTrigger(msg, undefined)).toEqual({ content: '讲个笑话' });
  });

  it('群聊未 @（无 mentioned）不触发', () => {
    expect(matchAiTrigger(groupMessage('在吗'), undefined)).toBeNull();
    expect(matchAiTrigger(groupMessage('[CQ:at,qq=10002] 在吗'), undefined)).toBeNull();
  });

  it('respondToAt=false 时群聊 @ 不触发', () => {
    const msg = groupMessage('[CQ:at,qq=10001] 在吗', { mentioned: true });
    expect(matchAiTrigger(msg, { respondToAt: false })).toBeNull();
  });

  it('私聊不凭 mentioned 触发（respondToPrivate=false 时 @ 私聊不触发）', () => {
    const msg = privateMessage('[CQ:at,qq=10001] 在吗', { mentioned: true });
    expect(matchAiTrigger(msg, { respondToPrivate: false })).toBeNull();
  });

  it('私聊 mentioned 不剥离文本（走 respondToPrivate 原文）', () => {
    const msg = privateMessage('在吗', { mentioned: true });
    expect(matchAiTrigger(msg, undefined)).toEqual({ content: '在吗' });
  });

  it('ignorePrefixes 命中不触发（默认 / ! ！）', () => {
    expect(matchAiTrigger(privateMessage('/help'), undefined)).toBeNull();
    expect(matchAiTrigger(privateMessage('!ping'), undefined)).toBeNull();
    expect(matchAiTrigger(privateMessage('！签到'), undefined)).toBeNull();
    // 即使群聊 @ 了机器人，命令前缀仍优先排除（与 legacy 一致）
    const msg = groupMessage('/help', { mentioned: true });
    expect(matchAiTrigger(msg, undefined)).toBeNull();
  });

  it('自定义 ignorePrefixes 覆盖默认值', () => {
    const trigger: AITriggerConfig = { ignorePrefixes: ['.'] };
    expect(matchAiTrigger(privateMessage('.help'), trigger)).toBeNull();
    expect(matchAiTrigger(privateMessage('/help'), trigger)).toEqual({ content: '/help' });
  });

  it('ai: 前缀触发（默认前缀含 # AI: ai:）', () => {
    expect(matchAiTrigger(privateMessage('ai: 讲个笑话'), undefined)).toEqual({ content: '讲个笑话' });
    expect(matchAiTrigger(privateMessage('#今天天气'), undefined)).toEqual({ content: '今天天气' });
    expect(matchAiTrigger(privateMessage('AI: 你好'), undefined)).toEqual({ content: '你好' });
  });

  it('群聊 ai: 前缀也生效（与 legacy 差异，新 Runtime 保留群聊前缀）', () => {
    expect(matchAiTrigger(groupMessage('ai: 讲个笑话'), undefined)).toEqual({ content: '讲个笑话' });
  });

  it('前缀后无正文不触发', () => {
    expect(matchAiTrigger(privateMessage('ai:'), undefined)).toBeNull();
  });

  it('respondToPrivate 默认开启，显式关闭后私聊不触发', () => {
    expect(matchAiTrigger(privateMessage('你好'), undefined)).toEqual({ content: '你好' });
    expect(matchAiTrigger(privateMessage('你好'), { respondToPrivate: false })).toBeNull();
  });

  it('关键词仅私聊触发', () => {
    const trigger: AITriggerConfig = { keywords: ['天气'] };
    expect(matchAiTrigger(privateMessage('今天天气怎样'), trigger)).toEqual({ content: '今天天气怎样' });
    expect(matchAiTrigger(groupMessage('今天天气怎样'), trigger)).toBeNull();
  });

  it('空白内容不触发', () => {
    expect(matchAiTrigger(privateMessage('   '), undefined)).toBeNull();
  });
});
