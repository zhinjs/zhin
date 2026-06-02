/**
 * 提示词模板系统
 *
 * 提供：
 * - 模板管理
 * - 国际化支持
 * - 智能裁剪
 * - 版本管理
 */

// ── 模板定义 ──────────────────────────────────────────────────────────

export interface PromptTemplate {
  /** 模板 ID */
  id: string;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description: string;
  /** 模板内容 */
  content: string;
  /** 模板变量 */
  variables: Array<{
    name: string;
    description: string;
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    required: boolean;
    defaultValue?: unknown;
  }>;
  /** 模板标签 */
  tags: string[];
  /** 模板版本 */
  version: string;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 作者 */
  author?: string;
  /** 语言 */
  language: string;
  /** 是否启用 */
  enabled: boolean;
}

// ── 模板版本 ──────────────────────────────────────────────────────────

export interface TemplateVersion {
  /** 版本号 */
  version: string;
  /** 模板内容 */
  content: string;
  /** 变更说明 */
  changelog?: string;
  /** 创建时间 */
  createdAt: number;
  /** 作者 */
  author?: string;
}

// ── 国际化消息 ────────────────────────────────────────────────────────

export interface I18nMessages {
  [key: string]: string | I18nMessages;
}

// ── 模板管理器类 ──────────────────────────────────────────────────────

export class PromptTemplateManager {
  private templates: Map<string, PromptTemplate> = new Map();
  private versions: Map<string, TemplateVersion[]> = new Map();
  private i18nMessages: Map<string, I18nMessages> = new Map();
  private currentLanguage: string = 'en';

  /**
   * 添加模板
   */
  addTemplate(template: PromptTemplate): void {
    this.templates.set(template.id, template);

    // 初始化版本历史
    if (!this.versions.has(template.id)) {
      this.versions.set(template.id, []);
    }

    // 添加当前版本
    this.versions.get(template.id)!.push({
      version: template.version,
      content: template.content,
      createdAt: Date.now(),
      author: template.author,
    });
  }

  /**
   * 获取模板
   */
  getTemplate(id: string): PromptTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * 获取所有模板
   */
  getAllTemplates(): PromptTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * 按标签获取模板
   */
  getTemplatesByTag(tag: string): PromptTemplate[] {
    return Array.from(this.templates.values()).filter(t => t.tags.includes(tag));
  }

  /**
   * 按语言获取模板
   */
  getTemplatesByLanguage(language: string): PromptTemplate[] {
    return Array.from(this.templates.values()).filter(t => t.language === language);
  }

  /**
   * 更新模板
   */
  updateTemplate(id: string, updates: Partial<PromptTemplate>): boolean {
    const template = this.templates.get(id);
    if (!template) {
      return false;
    }

    const updatedTemplate = { ...template, ...updates, updatedAt: Date.now() };
    this.templates.set(id, updatedTemplate);

    // 添加新版本
    if (updates.content && updates.content !== template.content) {
      const versions = this.versions.get(id) || [];
      versions.push({
        version: updates.version || template.version,
        content: updates.content,
        createdAt: Date.now(),
        author: updates.author || template.author,
      });
      this.versions.set(id, versions);
    }

    return true;
  }

  /**
   * 删除模板
   */
  deleteTemplate(id: string): boolean {
    const deleted = this.templates.delete(id);
    if (deleted) {
      this.versions.delete(id);
    }
    return deleted;
  }

  /**
   * 获取模板版本历史
   */
  getTemplateVersions(id: string): TemplateVersion[] {
    return this.versions.get(id) || [];
  }

  /**
   * 获取指定版本的模板
   */
  getTemplateVersion(id: string, version: string): TemplateVersion | undefined {
    const versions = this.versions.get(id) || [];
    return versions.find(v => v.version === version);
  }

  /**
   * 渲染模板
   */
  render(templateId: string, variables: Record<string, unknown> = {}): string {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    let content = template.content;

    // 替换变量
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      content = content.replace(new RegExp(placeholder, 'g'), String(value));
    }

    // 替换默认值
    for (const variable of template.variables) {
      if (variable.defaultValue !== undefined && !variables[variable.name]) {
        const placeholder = `{{${variable.name}}}`;
        content = content.replace(new RegExp(placeholder, 'g'), String(variable.defaultValue));
      }
    }

    return content;
  }

  /**
   * 设置当前语言
   */
  setLanguage(language: string): void {
    this.currentLanguage = language;
  }

  /**
   * 获取当前语言
   */
  getLanguage(): string {
    return this.currentLanguage;
  }

  /**
   * 添加国际化消息
   */
  addI18nMessages(language: string, messages: I18nMessages): void {
    this.i18nMessages.set(language, messages);
  }

  /**
   * 获取国际化消息
   */
  getI18nMessage(key: string, language?: string): string | undefined {
    const lang = language || this.currentLanguage;
    const messages = this.i18nMessages.get(lang);

    if (!messages) {
      return undefined;
    }

    // 支持嵌套键（如 "a.b.c"）
    const keys = key.split('.');
    let current: string | I18nMessages | undefined = messages;

    for (const k of keys) {
      if (typeof current !== 'object' || current === null) {
        return undefined;
      }
      current = current[k];
    }

    return typeof current === 'string' ? current : undefined;
  }

  /**
   * 渲染国际化模板
   */
  renderI18n(templateId: string, variables: Record<string, unknown> = {}, language?: string): string {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    const lang = language || this.currentLanguage;
    let content = template.content;

    // 替换国际化消息
    const i18nPattern = /\{\{i18n:([^}]+)\}\}/g;
    content = content.replace(i18nPattern, (match, key) => {
      const message = this.getI18nMessage(key.trim(), lang);
      return message || match;
    });

    // 替换变量
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      content = content.replace(new RegExp(placeholder, 'g'), String(value));
    }

    return content;
  }

  /**
   * 验证模板变量
   */
  validateVariables(templateId: string, variables: Record<string, unknown>): {
    valid: boolean;
    missing: string[];
    invalid: Array<{ name: string; expected: string; actual: string }>;
  } {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    const missing: string[] = [];
    const invalid: Array<{ name: string; expected: string; actual: string }> = [];

    for (const variable of template.variables) {
      const value = variables[variable.name];

      // 检查必需变量
      if (variable.required && (value === undefined || value === null)) {
        missing.push(variable.name);
        continue;
      }

      // 检查类型
      if (value !== undefined && value !== null) {
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        if (actualType !== variable.type) {
          invalid.push({
            name: variable.name,
            expected: variable.type,
            actual: actualType,
          });
        }
      }
    }

    return {
      valid: missing.length === 0 && invalid.length === 0,
      missing,
      invalid,
    };
  }

  /**
   * 智能裁剪模板内容
   */
  smartTrim(content: string, maxLength: number, options?: {
    preserveStructure?: boolean;
    preserveCodeBlocks?: boolean;
    preserveLists?: boolean;
  }): string {
    if (content.length <= maxLength) {
      return content;
    }

    const preserveStructure = options?.preserveStructure ?? true;
    const preserveCodeBlocks = options?.preserveCodeBlocks ?? true;
    const preserveLists = options?.preserveLists ?? true;

    // 分割内容为段落
    const paragraphs = content.split(/\n\n+/);
    let result = '';
    let currentLength = 0;

    for (const paragraph of paragraphs) {
      const paragraphLength = paragraph.length + 2; // +2 for \n\n

      // 检查是否超过最大长度
      if (currentLength + paragraphLength > maxLength) {
        // 如果保留结构，尝试保留完整的段落
        if (preserveStructure) {
          // 检查是否是代码块
          if (preserveCodeBlocks && paragraph.startsWith('```')) {
            // 尝试找到代码块的结束
            const codeBlockEnd = content.indexOf('```', content.indexOf(paragraph) + 3);
            if (codeBlockEnd !== -1) {
              const fullCodeBlock = content.substring(content.indexOf(paragraph), codeBlockEnd + 3);
              if (currentLength + fullCodeBlock.length <= maxLength) {
                result += fullCodeBlock + '\n\n';
                currentLength += fullCodeBlock.length + 2;
                continue;
              }
            }
          }

          // 检查是否是列表
          if (preserveLists && (paragraph.startsWith('- ') || paragraph.startsWith('* ') || /^\d+\./.test(paragraph))) {
            // 尝试保留完整的列表
            const listItems = paragraph.split('\n');
            let listContent = '';
            for (const item of listItems) {
              if (currentLength + listContent.length + item.length + 1 <= maxLength) {
                listContent += item + '\n';
              } else {
                break;
              }
            }
            if (listContent) {
              result += listContent.trim() + '\n\n';
              currentLength += listContent.length + 2;
              continue;
            }
          }
        }

        // 截断段落
        const remainingLength = maxLength - currentLength - 5; // 5 for "..."
        if (remainingLength > 0) {
          result += paragraph.substring(0, remainingLength) + '...\n\n';
        }
        break;
      }

      result += paragraph + '\n\n';
      currentLength += paragraphLength;
    }

    return result.trim();
  }

  /**
   * 导出模板
   */
  exportTemplate(id: string): string {
    const template = this.templates.get(id);
    if (!template) {
      throw new Error(`Template ${id} not found`);
    }

    return JSON.stringify(template, null, 2);
  }

  /**
   * 导入模板
   */
  importTemplate(json: string): PromptTemplate {
    const template = JSON.parse(json) as PromptTemplate;

    // 验证必需字段
    if (!template.id || !template.name || !template.content) {
      throw new Error('Invalid template format');
    }

    this.addTemplate(template);
    return template;
  }
}

// ── 预定义模板 ────────────────────────────────────────────────────────

export const DEFAULT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'main-agent',
    name: 'Main Agent Template',
    description: 'Main agent system prompt template',
    content: `You are a helpful AI assistant.

{{#if persona}}
Persona: {{persona}}
{{/if}}

{{#if context}}
Context: {{context}}
{{/if}}

{{#if tools}}
Available tools: {{tools}}
{{/if}}

{{#if safety}}
Safety rules:
{{safety}}
{{/if}}`,
    variables: [
      { name: 'persona', description: 'Agent persona', type: 'string', required: false },
      { name: 'context', description: 'Context information', type: 'string', required: false },
      { name: 'tools', description: 'Available tools', type: 'string', required: false },
      { name: 'safety', description: 'Safety rules', type: 'string', required: false },
    ],
    tags: ['main', 'agent', 'system'],
    version: '1.0.0',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    language: 'en',
    enabled: true,
  },
  {
    id: 'sub-agent',
    name: 'Sub-agent Template',
    description: 'Sub-agent system prompt template',
    content: `You are a sub-agent spawned by the main agent.

## Your task
{{task}}

## Rules
1. Focus only on the assigned task
2. Your final reply will be reported to the main agent
3. Do not start new conversations or take on extra tasks
4. Keep replies concise but informative

## You may
{{permissions}}

## You must not
{{restrictions}}`,
    variables: [
      { name: 'task', description: 'Task description', type: 'string', required: true },
      { name: 'permissions', description: 'Allowed actions', type: 'string', required: false },
      { name: 'restrictions', description: 'Restricted actions', type: 'string', required: false },
    ],
    tags: ['sub-agent', 'task'],
    version: '1.0.0',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    language: 'en',
    enabled: true,
  },
  {
    id: 'worker-agent',
    name: 'Worker Agent Template',
    description: 'Worker agent system prompt template',
    content: `You are a worker agent executing a delegated task.

## Task
{{task}}

## Goal
{{goal}}

## Tools
{{tools}}

## Constraints
{{constraints}}`,
    variables: [
      { name: 'task', description: 'Task description', type: 'string', required: true },
      { name: 'goal', description: 'Task goal', type: 'string', required: true },
      { name: 'tools', description: 'Available tools', type: 'string', required: false },
      { name: 'constraints', description: 'Task constraints', type: 'string', required: false },
    ],
    tags: ['worker', 'task'],
    version: '1.0.0',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    language: 'en',
    enabled: true,
  },
];

// ── 全局实例 ──────────────────────────────────────────────────────────

let globalTemplateManager: PromptTemplateManager | null = null;

/**
 * 获取全局模板管理器
 */
export function getTemplateManager(): PromptTemplateManager {
  if (!globalTemplateManager) {
    globalTemplateManager = new PromptTemplateManager();

    // 添加预定义模板
    for (const template of DEFAULT_TEMPLATES) {
      globalTemplateManager.addTemplate(template);
    }
  }
  return globalTemplateManager;
}

/**
 * 初始化模板管理器
 */
export function initTemplateManager(): PromptTemplateManager {
  globalTemplateManager = new PromptTemplateManager();

  // 添加预定义模板
  for (const template of DEFAULT_TEMPLATES) {
    globalTemplateManager.addTemplate(template);
  }

  return globalTemplateManager;
}
