/**
 * AI Trigger 工具函数
 * 提供 AI 触发相关的工具函数，可在插件中直接使用
 * 
 * 触发方式：
 * 1. @机器人 - 在群聊中 @ 机器人触发
 * 2. 前缀触发 - 使用配置的前缀（如 # 或 AI:）
 * 3. 私聊直接对话 - 私聊时直接对话
 * 4. 关键词触发 - 包含特定关键词时触发
 */

import { Message } from "../message.js";
import type { 
  MessageElement,
  ToolScope,
  ToolPermissionLevel,
  MaybePromise, 
} from "../types.js";
import { segment } from "../utils.js";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * AI 触发配置
 */
export interface AITriggerConfig {
  /** 是否启用（默认 true） */
  enabled?: boolean;
  
  /** 触发前缀列表（默认 ['#', 'AI:']） */
  prefixes?: string[];
  
  /** 是否响应 @ 机器人（默认 true） */
  respondToAt?: boolean;
  
  /** 是否响应私聊（默认 true） */
  respondToPrivate?: boolean;
  
  /** 触发关键词（可选） */
  keywords?: string[];
  
  /** 忽略的前缀（命令前缀，避免与命令冲突） */
  ignorePrefixes?: string[];
  
  /** 超时时间（毫秒，默认 60000） */
  timeout?: number;
  
  /** 思考中提示（可选） */
  thinkingMessage?: string;
  
  /** 错误消息模板 */
  errorTemplate?: string;
  
  /** Zhin 拥有者 ID 列表 */
  owners?: string[];
  
  /** 机器人管理员 ID 列表 */
  botAdmins?: string[];
}

/**
 * AI 触发检查结果
 */
export interface AITriggerResult {
  triggered: boolean;
  content: string;
}

/**
 * 发送者权限信息
 */
export interface SenderPermissions {
  scope: ToolScope;
  isGroupAdmin: boolean;
  isGroupOwner: boolean;
  isBotAdmin: boolean;
  isOwner: boolean;
  permissionLevel: ToolPermissionLevel;
}

// ============================================================================
// 默认配置
// ============================================================================

export const DEFAULT_AI_TRIGGER_CONFIG: Required<AITriggerConfig> = {
  enabled: true,
  prefixes: ['#', 'AI:', 'ai:'],
  respondToAt: true,
  respondToPrivate: true,
  keywords: [],
  ignorePrefixes: ['/', '!', '！'],
  timeout: 60000,
  thinkingMessage: '',
  errorTemplate: '❌ AI 处理失败: {error}',
  owners: [],
  botAdmins: [],
};

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 检查消息是否 @ 了机器人
 */
export function isAtBot<T extends object>(message: Message<T>): boolean {
  return message.$content.some(seg =>  {
    return seg.data?.qq === message.$bot || seg.data?.user_id === message.$bot;
  });
}

/**
 * 提取消息文本内容（保留富媒体信息）
 * 使用 segment.toString 将 MessageElement 转为 XML 格式
 */
export function extractTextContent<T extends object>(message: Message<T>): string {
  return segment.toString(message.$content);
}

/**
 * 解析 AI 回复中的富媒体内容
 * 将字符串中的 XML-like 标签解析为 MessageElement
 */
export function parseRichMediaContent(content: string): MessageElement[] {
  try {
    const parsed = segment.from(content);
    const elements = Array.isArray(parsed) ? parsed : [parsed];
    return elements.map(el => {
      if (typeof el === 'string') {
        return { type: 'text', data: { text: el } };
      }
      return el as MessageElement;
    });
  } catch (error) {
    return [{ type: 'text', data: { text: content } }];
  }
}

/**
 * 移除 @ 机器人的部分
 */
export function removeAtBot<T extends object>(message: Message<T>): MessageElement[] {
  return message.$content.filter(seg => {
    const { type, data } = seg;
    const userId = data?.user_id || data?.qq;
    return type !== "at" && userId !== message.$bot;
  });
}

/**
 * 从消息中推断发送者的权限级别
 */
export function inferSenderPermissions<T extends object>(
  message: Message<T>,
  config: AITriggerConfig
): SenderPermissions {
  const scope: ToolScope = message.$channel?.type as ToolScope || 'private';
  const senderId = message.$sender.id;
  const senderPermissions = message.$sender.permissions || [];
  
  const owners = config.owners || [];
  const isOwner = owners.includes(senderId);
  
  const botAdmins = config.botAdmins || [];
  const isBotAdmin = isOwner || botAdmins.includes(senderId);
  
  const isGroupOwner = senderPermissions.includes('owner') || 
                       senderPermissions.includes('group_owner') ||
                       (message as any).$sender?.role === 'owner';
  
  const isGroupAdmin = isGroupOwner || 
                       senderPermissions.includes('admin') || 
                       senderPermissions.includes('group_admin') ||
                       (message as any).$sender?.role === 'admin';
  
  let permissionLevel: ToolPermissionLevel = 'user';
  if (isOwner) permissionLevel = 'owner';
  else if (isBotAdmin) permissionLevel = 'bot_admin';
  else if (isGroupOwner) permissionLevel = 'group_owner';
  else if (isGroupAdmin) permissionLevel = 'group_admin';
  
  return {
    scope,
    isGroupAdmin,
    isGroupOwner,
    isBotAdmin,
    isOwner,
    permissionLevel,
  };
}

/**
 * 检查消息是否应该触发 AI
 */
export function shouldTriggerAI<T extends object>(
  message: Message<T>, 
  config: AITriggerConfig
): AITriggerResult {
  const fullConfig = { ...DEFAULT_AI_TRIGGER_CONFIG, ...config };
  
  if (!fullConfig.enabled) {
    return { triggered: false, content: '' };
  }
  
  const text = extractTextContent(message);
  
  // 检查忽略前缀
  for (const prefix of fullConfig.ignorePrefixes) {
    if (text.startsWith(prefix)) {
      return { triggered: false, content: '' };
    }
  }
  
  // 1. 检查前缀触发
  for (const prefix of fullConfig.prefixes) {
    if (text.startsWith(prefix)) {
      return { triggered: true, content: text.slice(prefix.length).trim() };
    }
  }
  
  // 2. 检查 @ 触发
  if (fullConfig.respondToAt && isAtBot(message)) {
    const content = removeAtBot(message);
    if (content.length) {
      return { triggered: true, content: segment.toString(content) };
    }
  }
  
  // 3. 检查私聊触发
  if (fullConfig.respondToPrivate && message.$channel?.type === 'private') {
    if (text.trim()) {
      return { triggered: true, content: text.trim() };
    }
  }
  
  // 4. 检查关键词触发
  if (fullConfig.keywords.length > 0) {
    const lowerText = text.toLowerCase();
    for (const keyword of fullConfig.keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return { triggered: true, content: text };
      }
    }
  }
  
  return { triggered: false, content: '' };
}

/**
 * 合并配置
 */
export function mergeAITriggerConfig(config: AITriggerConfig): Required<AITriggerConfig> {
  return { ...DEFAULT_AI_TRIGGER_CONFIG, ...config };
}
