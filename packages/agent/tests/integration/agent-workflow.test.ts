/**
 * Agent 工作流集成测试
 *
 * 测试完整的 Agent 工作流程，包括：
 * - 安全策略集成
 * - 沙箱环境集成
 * - 监控系统集成
 * - Agent 调度器集成
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnhancedSandbox } from '../../src/security/sandbox-enhanced.js';
import { AgentDispatcher } from '../../src/orchestrator/agent-dispatcher.js';
import { PromptBuilder } from '../../src/zhin-agent/prompt-builder.js';
import {
  initMonitoring,
  getMetricsCollector,
  getTraceCollector,
  getAlertManager,
} from '../../src/monitoring/index.js';

describe('Agent Workflow Integration', () => {
  let sandbox: EnhancedSandbox;
  let dispatcher: AgentDispatcher;
  let monitoring: ReturnType<typeof initMonitoring>;

  beforeEach(() => {
    // 初始化沙箱
    sandbox = new EnhancedSandbox({
      enabled: true,
      timeout: 5000,
      workingDirectory: '/tmp/integration-test',
      enableNetwork: false,
      fileSystem: {
        allowedPaths: ['/tmp/integration-test'],
        blockedPaths: ['/etc/shadow'],
        allowDelete: false,
      },
    });

    // 初始化调度器
    dispatcher = new AgentDispatcher();

    // 初始化监控
    monitoring = initMonitoring();
  });

  afterEach(() => {
    // 清理测试目录
    try {
      const fs = require('fs');
      if (fs.existsSync('/tmp/integration-test')) {
        fs.rmSync('/tmp/integration-test', { recursive: true, force: true });
      }
    } catch {
      // 忽略清理错误
    }
  });

  describe('安全策略集成', () => {
    it('应该执行安全的命令', async () => {
      const result = await sandbox.execute('echo "safe command"');
      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('safe command');
    });

    it('应该阻止危险的命令', async () => {
      const result = await sandbox.execute('sudo rm -rf /');
      expect(result.blocked).toBe(true);
    });

    it('应该阻止网络访问', async () => {
      const result = await sandbox.execute('curl http://example.com');
      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('禁止网络访问');
    });

    it('应该阻止删除文件', async () => {
      const result = await sandbox.execute('rm -rf /tmp/test');
      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('禁止删除文件');
    });
  });

  describe('Agent 调度器集成', () => {
    it('应该创建任务', () => {
      const task = dispatcher.createTask({
        name: 'Test Task',
        description: 'A test task',
        role: 'subtask',
        goal: 'Complete the test',
        priority: 'medium',
      });

      expect(task.id).toBeDefined();
      expect(task.name).toBe('Test Task');
      expect(task.role).toBe('subtask');
    });

    it('应该过滤工具', () => {
      const tools = [
        { name: 'read_file', execute: async () => '' },
        { name: 'write_file', execute: async () => '' },
        { name: 'bash', execute: async () => '' },
        { name: 'send_message', execute: async () => '' },
      ];

      const filtered = dispatcher.filterToolsByRole(tools as any, 'researcher');
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('read_file');
    });

    it('应该构建角色提示词', () => {
      const task = dispatcher.createTask({
        name: 'Test Task',
        description: 'A test task',
        role: 'subtask',
        goal: 'Complete the test',
        priority: 'medium',
      });

      const prompt = dispatcher.buildRolePrompt('subtask', task);
      expect(prompt).toContain('subtask');
      expect(prompt).toContain('Test Task');
    });
  });

  describe('监控系统集成', () => {
    it('应该记录工具执行', () => {
      const metrics = getMetricsCollector();
      metrics.increment('agent_tool_executions_total', {
        tool: 'bash',
        status: 'success',
        platform: 'test',
      });

      const values = metrics.getValues('agent_tool_executions_total');
      expect(values.length).toBe(1);
      expect(values[0].value).toBe(1);
    });

    it('应该记录追踪', () => {
      const traces = getTraceCollector();
      const span = traces.startSpan('test-operation');

      traces.addEvent(span.spanId, 'test-event');
      traces.endSpan(span.spanId, { code: 'OK' });

      const allSpans = traces.getAllSpans();
      expect(allSpans.length).toBe(1);
      expect(allSpans[0].name).toBe('test-operation');
    });

    it('应该检查告警', () => {
      const alerts = getAlertManager();
      const metrics = getMetricsCollector();

      // 添加一个总是触发的告警规则
      alerts.addRule({
        id: 'test-alert',
        name: 'Test Alert',
        description: 'Test alert',
        condition: () => true,
        severity: 'warning',
        message: 'Test alert triggered',
        enabled: true,
      });

      const triggeredAlerts = alerts.checkAlerts(metrics);
      expect(triggeredAlerts.length).toBe(1);
      expect(triggeredAlerts[0].message).toBe('Test alert triggered');
    });
  });

  describe('提示词构建器集成', () => {
    it('应该构建提示词', () => {
      const builder = new PromptBuilder({
        maxTotalChars: 10000,
        enableSafetyRules: true,
      });

      const prompt = builder
        .addSystemPrompt('You are a helpful assistant.')
        .addRoleDefinition('main')
        .addTaskDescription({
          name: 'Test Task',
          description: 'A test task',
          goal: 'Complete the test',
        })
        .addSafetyRules()
        .build();

      expect(prompt).toContain('You are a helpful assistant.');
      expect(prompt).toContain('main');
      expect(prompt).toContain('Test Task');
      expect(prompt).toContain('ZHIN_NEEDS_OWNER');
    });
  });

  describe('完整工作流', () => {
    it('应该执行完整的 Agent 工作流', async () => {
      // 1. 创建任务
      const task = dispatcher.createTask({
        name: 'Integration Test',
        description: 'Run integration test',
        role: 'executor',
        goal: 'Complete integration test',
        priority: 'high',
      });

      // 2. 过滤工具
      const tools = [
        { name: 'read_file', execute: async () => 'file content' },
        { name: 'write_file', execute: async () => 'written' },
        { name: 'bash', execute: async () => 'executed' },
      ];
      const allowedTools = dispatcher.filterToolsByRole(tools as any, 'executor');
      expect(allowedTools.length).toBe(3);

      // 3. 构建提示词
      const prompt = dispatcher.buildRolePrompt('executor', task);
      expect(prompt).toContain('executor');

      // 4. 在沙箱中执行命令
      const result = await sandbox.execute('echo "integration test"');
      expect(result.success).toBe(true);

      // 5. 记录监控数据
      const metrics = getMetricsCollector();
      const beforeCount = metrics.getValues('agent_tool_executions_total').length;

      metrics.increment('agent_tool_executions_total', {
        tool: 'bash',
        status: 'success',
        platform: 'test',
      });

      const traces = getTraceCollector();
      const beforeSpanCount = traces.getAllSpans().length;
      const span = traces.startSpan('integration-test');
      traces.endSpan(span.spanId, { code: 'OK' });

      // 6. 验证监控数据
      const toolExecutions = metrics.getValues('agent_tool_executions_total');
      expect(toolExecutions.length).toBeGreaterThanOrEqual(1);

      const allSpans = traces.getAllSpans();
      expect(allSpans.length).toBeGreaterThanOrEqual(1);
    });

    it('应该处理错误情况', async () => {
      // 1. 尝试执行危险命令
      const result = await sandbox.execute('sudo rm -rf /');
      expect(result.blocked).toBe(true);

      // 2. 记录安全事件
      const metrics = getMetricsCollector();
      metrics.increment('agent_security_events_total', {
        type: 'violation',
        severity: 'critical',
        platform: 'test',
      });

      // 3. 检查告警
      const alerts = getAlertManager();
      const triggeredAlerts = alerts.checkAlerts(metrics);
      expect(triggeredAlerts.length).toBeGreaterThan(0);
    });
  });
});
