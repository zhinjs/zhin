import { describe, it, expect, beforeEach } from 'vitest';
import {
  PromptTemplateManager,
  initTemplateManager,
  getTemplateManager,
  DEFAULT_TEMPLATES,
} from '../../src/zhin-agent/prompt-templates.js';

describe('PromptTemplateManager', () => {
  let manager: PromptTemplateManager;

  beforeEach(() => {
    manager = new PromptTemplateManager();
  });

  describe('基本功能', () => {
    it('应该创建管理器', () => {
      expect(manager).toBeDefined();
    });

    it('应该添加模板', () => {
      manager.addTemplate({
        id: 'test-template',
        name: 'Test Template',
        description: 'A test template',
        content: 'Hello, {{name}}!',
        variables: [
          { name: 'name', description: 'User name', type: 'string', required: true },
        ],
        tags: ['test'],
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        language: 'en',
        enabled: true,
      });

      const template = manager.getTemplate('test-template');
      expect(template).toBeDefined();
      expect(template?.name).toBe('Test Template');
    });

    it('应该获取模板', () => {
      manager.addTemplate({
        id: 'test-template',
        name: 'Test Template',
        description: 'A test template',
        content: 'Hello, {{name}}!',
        variables: [],
        tags: ['test'],
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        language: 'en',
        enabled: true,
      });

      const template = manager.getTemplate('test-template');
      expect(template).toBeDefined();
      expect(template?.id).toBe('test-template');
    });

    it('应该获取所有模板', () => {
      manager.addTemplate({
        id: 'template-1',
        name: 'Template 1',
        description: 'Template 1',
        content: 'Template 1',
        variables: [],
        tags: ['test'],
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        language: 'en',
        enabled: true,
      });

      manager.addTemplate({
        id: 'template-2',
        name: 'Template 2',
        description: 'Template 2',
        content: 'Template 2',
        variables: [],
        tags: ['test'],
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        language: 'en',
        enabled: true,
      });

      const templates = manager.getAllTemplates();
      expect(templates.length).toBe(2);
    });

    it('应该按标签获取模板', () => {
      manager.addTemplate({
        id: 'template-1',
        name: 'Template 1',
        description: 'Template 1',
        content: 'Template 1',
        variables: [],
        tags: ['tag1', 'tag2'],
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        language: 'en',
        enabled: true,
      });

      manager.addTemplate({
        id: 'template-2',
        name: 'Template 2',
        description: 'Template 2',
        content: 'Template 2',
        variables: [],
        tags: ['tag2', 'tag3'],
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        language: 'en',
        enabled: true,
      });

      const templates = manager.getTemplatesByTag('tag2');
      expect(templates.length).toBe(2);

      const templatesWithTag1 = manager.getTemplatesByTag('tag1');
      expect(templatesWithTag1.length).toBe(1);
    });

    it('应该按语言获取模板', () => {
      manager.addTemplate({
        id: 'template-en',
        name: 'Template EN',
        description: 'Template EN',
        content: 'Template EN',
        variables: [],
        tags: [],
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        language: 'en',
        enabled: true,
      });

      manager.addTemplate({
        id: 'template-zh',
        name: 'Template ZH',
        description: 'Template ZH',
        content: 'Template ZH',
        variables: [],
        tags: [],
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        language: 'zh',
        enabled: true,
      });

      const enTemplates = manager.getTemplatesByLanguage('en');
      expect(enTemplates.length).toBe(1);

      const zhTemplates = manager.getTemplatesByLanguage('zh');
      expect(zhTemplates.length).toBe(1);
    });
  });

  describe('模板操作', () => {
    it('应该更新模板', () => {
      manager.addTemplate({
        id: 'test-template',
        name: 'Test Template',
        description: 'A test template',
        content: 'Hello, {{name}}!',
        variables: [],
        tags: ['test'],
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        language: 'en',
        enabled: true,
      });

      const updated = manager.updateTemplate('test-template', {
        name: 'Updated Template',
        content: 'Hello, {{name}}! Updated.',
      });

      expect(updated).toBe(true);

      const template = manager.getTemplate('test-template');
      expect(template?.name).toBe('Updated Template');
      expect(template?.content).toBe('Hello, {{name}}! Updated.');
    });

    it('应该删除模板', () => {
      manager.addTemplate({
        id: 'test-template',
        name: 'Test Template',
        description: 'A test template',
        content: 'Hello, {{name}}!',
        variables: [],
        tags: ['test'],
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        language: 'en',
        enabled: true,
      });

      const deleted = manager.deleteTemplate('test-template');
      expect(deleted).toBe(true);

      const template = manager.getTemplate('test-template');
      expect(template).toBeUndefined();
    });

    it('应该获取模板版本历史', () => {
      manager.addTemplate({
        id: 'test-template',
        name: 'Test Template',
        description: 'A test template',
        content: 'Version 1',
        variables: [],
        tags: ['test'],
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        language: 'en',
        enabled: true,
      });

      manager.updateTemplate('test-template', {
        content: 'Version 2',
        version: '2.0.0',
      });

      const versions = manager.getTemplateVersions('test-template');
      expect(versions.length).toBe(2);
      expect(versions[0].version).toBe('1.0.0');
      expect(versions[1].version).toBe('2.0.0');
    });

    it('应该获取指定版本的模板', () => {
      manager.addTemplate({
        id: 'test-template',
        name: 'Test Template',
        description: 'A test template',
        content: 'Version 1',
        variables: [],
        tags: ['test'],
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        language: 'en',
        enabled: true,
      });

      manager.updateTemplate('test-template', {
        content: 'Version 2',
        version: '2.0.0',
      });

      const version1 = manager.getTemplateVersion('test-template', '1.0.0');
      expect(version1?.content).toBe('Version 1');

      const version2 = manager.getTemplateVersion('test-template', '2.0.0');
      expect(version2?.content).toBe('Version 2');
    });
  });

  describe('模板渲染', () => {
    it('应该渲染模板', () => {
      manager.addTemplate({
        id: 'test-template',
        name: 'Test Template',
        description: 'A test template',
        content: 'Hello, {{name}}! You are {{age}} years old.',
        variables: [
          { name: 'name', description: 'User name', type: 'string', required: true },
          { name: 'age', description: 'User age', type: 'number', required: true },
        ],
        tags: ['test'],
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        language: 'en',
        enabled: true,
      });

      const rendered = manager.render('test-template', { name: 'Alice', age: 30 });
      expect(rendered).toBe('Hello, Alice! You are 30 years old.');
    });

    it('应该使用默认值', () => {
      manager.addTemplate({
        id: 'test-template',
        name: 'Test Template',
        description: 'A test template',
        content: 'Hello, {{name}}! You are {{age}} years old.',
        variables: [
          { name: 'name', description: 'User name', type: 'string', required: true },
          { name: 'age', description: 'User age', type: 'number', required: false, defaultValue: 25 },
        ],
        tags: ['test'],
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        language: 'en',
        enabled: true,
      });

      const rendered = manager.render('test-template', { name: 'Alice' });
      expect(rendered).toBe('Hello, Alice! You are 25 years old.');
    });

    it('应该验证模板变量', () => {
      manager.addTemplate({
        id: 'test-template',
        name: 'Test Template',
        description: 'A test template',
        content: 'Hello, {{name}}!',
        variables: [
          { name: 'name', description: 'User name', type: 'string', required: true },
        ],
        tags: ['test'],
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        language: 'en',
        enabled: true,
      });

      // 有效变量
      const valid = manager.validateVariables('test-template', { name: 'Alice' });
      expect(valid.valid).toBe(true);
      expect(valid.missing.length).toBe(0);

      // 缺少必需变量
      const invalid = manager.validateVariables('test-template', {});
      expect(invalid.valid).toBe(false);
      expect(invalid.missing).toContain('name');
    });
  });

  describe('国际化', () => {
    it('应该设置语言', () => {
      manager.setLanguage('zh');
      expect(manager.getLanguage()).toBe('zh');
    });

    it('应该添加国际化消息', () => {
      manager.addI18nMessages('en', {
        greeting: 'Hello',
        farewell: 'Goodbye',
      });

      manager.addI18nMessages('zh', {
        greeting: '你好',
        farewell: '再见',
      });

      manager.setLanguage('en');
      expect(manager.getI18nMessage('greeting')).toBe('Hello');

      manager.setLanguage('zh');
      expect(manager.getI18nMessage('greeting')).toBe('你好');
    });

    it('应该支持嵌套键', () => {
      manager.addI18nMessages('en', {
        user: {
          greeting: 'Hello, user!',
          farewell: 'Goodbye, user!',
        },
      });

      expect(manager.getI18nMessage('user.greeting')).toBe('Hello, user!');
    });

    it('应该渲染国际化模板', () => {
      manager.addI18nMessages('en', {
        greeting: 'Hello',
        farewell: 'Goodbye',
      });

      manager.addTemplate({
        id: 'i18n-template',
        name: 'I18n Template',
        description: 'I18n template',
        content: '{{i18n:greeting}}, {{name}}! {{i18n:farewell}}!',
        variables: [
          { name: 'name', description: 'User name', type: 'string', required: true },
        ],
        tags: ['i18n'],
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        language: 'en',
        enabled: true,
      });

      const rendered = manager.renderI18n('i18n-template', { name: 'Alice' }, 'en');
      expect(rendered).toBe('Hello, Alice! Goodbye!');
    });
  });

  describe('智能裁剪', () => {
    it('应该裁剪长内容', () => {
      const content = 'A'.repeat(1000);
      const trimmed = manager.smartTrim(content, 100);
      expect(trimmed.length).toBeLessThanOrEqual(100);
      expect(trimmed).toContain('...');
    });

    it('应该保留代码块', () => {
      const content = `Some text

\`\`\`javascript
const x = 1;
const y = 2;
\`\`\`

More text`;

      const trimmed = manager.smartTrim(content, 50, { preserveCodeBlocks: true });
      expect(trimmed).toContain('```');
    });

    it('应该保留列表', () => {
      const content = `Some text

- Item 1
- Item 2
- Item 3
- Item 4
- Item 5

More text`;

      const trimmed = manager.smartTrim(content, 50, { preserveLists: true });
      expect(trimmed).toContain('- Item');
    });
  });

  describe('导入导出', () => {
    it('应该导出模板', () => {
      manager.addTemplate({
        id: 'test-template',
        name: 'Test Template',
        description: 'A test template',
        content: 'Hello, {{name}}!',
        variables: [],
        tags: ['test'],
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        language: 'en',
        enabled: true,
      });

      const exported = manager.exportTemplate('test-template');
      expect(exported).toBeDefined();

      const parsed = JSON.parse(exported);
      expect(parsed.id).toBe('test-template');
    });

    it('应该导入模板', () => {
      const template = {
        id: 'imported-template',
        name: 'Imported Template',
        description: 'An imported template',
        content: 'Hello, {{name}}!',
        variables: [],
        tags: ['imported'],
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        language: 'en',
        enabled: true,
      };

      const imported = manager.importTemplate(JSON.stringify(template));
      expect(imported.id).toBe('imported-template');

      const retrieved = manager.getTemplate('imported-template');
      expect(retrieved).toBeDefined();
    });
  });

  describe('预定义模板', () => {
    it('应该有预定义模板', () => {
      expect(DEFAULT_TEMPLATES.length).toBeGreaterThan(0);
      expect(DEFAULT_TEMPLATES[0].id).toBeDefined();
      expect(DEFAULT_TEMPLATES[0].name).toBeDefined();
    });
  });

  describe('全局实例', () => {
    it('应该获取全局实例', () => {
      const instance = getTemplateManager();
      expect(instance).toBeDefined();
    });

    it('应该初始化全局实例', () => {
      const instance = initTemplateManager();
      expect(instance).toBeDefined();
    });

    it('应该使用预定义模板', () => {
      const manager = initTemplateManager();
      const templates = manager.getAllTemplates();
      expect(templates.length).toBeGreaterThan(0);
    });
  });
});
