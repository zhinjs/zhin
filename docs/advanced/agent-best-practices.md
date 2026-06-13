# Agent 最佳实践指南

本文档提供了使用 zhin.js Agent 的最佳实践和故障排除指南。

## 目录

1. [安全最佳实践](#安全最佳实践)
2. [性能优化](#性能优化)
3. [监控和调试](#监控和调试)
4. [故障排除](#故障排除)
5. [常见问题](#常见问题)

## 安全最佳实践

### 1. 沙箱环境配置

```typescript
import { EnhancedSandbox } from '@zhin.js/agent';

const sandbox = new EnhancedSandbox({
  enabled: true,
  workingDirectory: '/safe/workspace',
  timeout: 30000,
  maxMemoryMB: 512,
  enableNetwork: false,
  fileSystem: {
    allowedPaths: ['/safe/workspace'],
    blockedPaths: ['/etc/shadow', '/root/.ssh'],
    blockedExtensions: ['.pem', '.key'],
    allowDelete: false,
  },
  monitoring: {
    enabled: true,
    interval: 1000,
    thresholds: {
      cpuPercent: 80,
      memoryMB: 400,
    },
  },
});
```

**关键点**：
- 始终启用沙箱环境
- 限制工作目录范围
- 禁止网络访问（除非必要）
- 监控资源使用

### 2. 安全策略配置

```typescript
import { initSecurityPolicies } from '@zhin.js/agent';

const policies = initSecurityPolicies({
  audit: {
    enabled: true,
    logFile: 'data/audit/agent-audit.log',
    minSeverity: 'info',
    logSensitiveData: false,
  },
  network: {
    enabled: true,
    allowedDomains: ['api.openai.com', 'github.com'],
    blockPrivateIPs: true,
  },
  budget: {
    enabled: true,
    maxTokensPerSession: 1000000,
    maxCostPerSession: 10.0,
    maxToolCallsPerSession: 100,
  },
});
```

**关键点**：
- 始终启用审计日志
- 配置域名白名单
- 设置预算限制
- 定期审查日志

### 3. Agent 角色管理

```typescript
import { AgentDispatcher } from '@zhin.js/agent';

const dispatcher = new AgentDispatcher();

// 使用最小权限原则
const task = dispatcher.createTask({
  name: 'Read-only Task',
  role: 'researcher', // 只读角色
  goal: 'Analyze codebase',
  priority: 'medium',
});

// 过滤工具
const allowedTools = dispatcher.filterToolsByRole(tools, 'researcher');
```

**关键点**：
- 使用最小权限角色
- 限制工具访问
- 验证任务依赖

## 性能优化

### 1. 提示词优化

```typescript
import { PromptBuilder } from '@zhin.js/agent';

const builder = new PromptBuilder({
  maxTotalChars: 50000, // 限制总字符数
  enableSafetyRules: true,
  enableConstraints: true,
});

const prompt = builder
  .addSystemPrompt('You are a helpful assistant.', { priority: 100 })
  .addRoleDefinition('main', { priority: 90 })
  .addTaskDescription(task, { priority: 80 })
  .addSafetyRules({ priority: 95 })
  .build();
```

**优化技巧**：
- 设置合理的最大字符数
- 使用优先级排序
- 启用智能裁剪
- 避免重复内容

### 2. 任务队列管理

```typescript
import { TaskQueue } from '@zhin.js/agent';

const queue = new TaskQueue({
  maxConcurrency: 5,
  defaultTimeout: 60000,
  enablePriority: true,
  enableDAG: true,
});

// 添加任务
queue.addTask({
  name: 'High Priority Task',
  priority: 'high',
  execute: async () => {
    // 执行任务
    return result;
  },
});

// 启动队列
await queue.start();
```

**优化技巧**：
- 设置合理的并发数
- 使用优先级队列
- 配置超时和重试
- 监控队列状态

### 3. 缓存策略

```typescript
import { getMetricsCollector } from '@zhin.js/agent';

const metrics = getMetricsCollector();

// 缓存频繁访问的数据
const cachedResult = await cache.get(key);
if (cachedResult) {
  metrics.increment('cache_hits');
  return cachedResult;
}

// 计算结果
const result = await compute();
await cache.set(key, result);
metrics.increment('cache_misses');
```

**优化技巧**：
- 缓存频繁访问的数据
- 监控缓存命中率
- 设置合理的过期时间
- 使用分布式缓存

## 监控和调试

### 1. 性能监控

```typescript
import { initMonitoring, getMetricsCollector } from '@zhin.js/agent';

const monitoring = initMonitoring();
const metrics = getMetricsCollector();

// 记录工具执行
metrics.increment('agent_tool_executions_total', {
  tool: 'bash',
  status: 'success',
  platform: 'qq',
});

// 记录执行时间
const startTime = Date.now();
const result = await executeTool();
const duration = Date.now() - startTime;

metrics.observe('agent_tool_execution_duration_seconds', duration / 1000, {
  tool: 'bash',
  platform: 'qq',
});
```

**监控指标**：
- 工具执行次数
- 执行时间分布
- 错误率
- Token 使用量

### 2. 分布式追踪

```typescript
import { getTraceCollector } from '@zhin.js/agent';

const traces = getTraceCollector();

// 开始追踪
const span = traces.startSpan('tool-execution');
traces.setAttributes(span.spanId, {
  tool: 'bash',
  command: 'ls -la',
});

try {
  const result = await executeTool();
  traces.addEvent(span.spanId, 'success');
  traces.endSpan(span.spanId, { code: 'OK' });
} catch (error) {
  traces.addEvent(span.spanId, 'error', { error: error.message });
  traces.endSpan(span.spanId, { code: 'ERROR', message: error.message });
}
```

**追踪要点**：
- 追踪关键操作
- 记录属性和事件
- 处理错误情况
- 分析性能瓶颈

### 3. 告警配置

```typescript
import { getAlertManager } from '@zhin.js/agent';

const alerts = getAlertManager();

// 添加自定义告警规则
alerts.addRule({
  id: 'high-error-rate',
  name: 'High Error Rate',
  description: 'Error rate exceeds threshold',
  condition: (metrics) => {
    const errors = metrics.getValues('agent_errors_total');
    const total = errors.reduce((sum, v) => sum + v.value, 0);
    return total > 100;
  },
  severity: 'error',
  message: 'High error rate detected',
  enabled: true,
});

// 检查告警
const triggeredAlerts = alerts.checkAlerts(metrics);
if (triggeredAlerts.length > 0) {
  console.error('Alerts triggered:', triggeredAlerts);
}
```

**告警要点**：
- 设置合理的阈值
- 配置多种严重程度
- 定期审查告警
- 及时响应告警

## 故障排除

### 1. 命令被拒绝

**问题**：命令被 exec policy 拒绝

**排查步骤**：
1. 检查 `execSecurity` 配置
2. 查看审计日志
3. 检查命令是否在黑名单中

**解决方案**：
```typescript
// 添加命令到白名单
execAllowlist: ['git', 'npm', 'pnpm'],

// 或使用预设
execPreset: 'development',

// 或启用 Owner 确认
execApprovalMode: ask,
```

### 2. 文件访问被拒绝

**问题**：文件访问被 file policy 拒绝

**排查步骤**：
1. 检查文件路径是否包含敏感目录
2. 检查文件名是否匹配敏感模式
3. 查看审计日志

**解决方案**：
```typescript
// 使用相对路径
const filePath = './src/index.ts';

// 或检查沙箱配置
sandbox.checkFileAccess(filePath);
```

### 3. 网络访问被拒绝

**问题**：网络访问被 network policy 拒绝

**排查步骤**：
1. 检查域名是否在白名单中
2. 检查是否访问了私有 IP
3. 查看审计日志

**解决方案**：
```typescript
// 添加域名到白名单
allowedDomains: ['api.openai.com', 'github.com'],

// 或禁用网络策略
enableNetwork: true,
```

### 4. 预算超限

**问题**：预算限制被触发

**排查步骤**：
1. 检查 Token 使用量
2. 检查工具调用次数
3. 查看预算统计

**解决方案**：
```typescript
// 增加预算限制
maxTokensPerSession: 2000000,
maxToolCallsPerSession: 200,

// 或优化 Token 使用
// - 使用更简洁的提示词
// - 减少不必要的工具调用
// - 使用缓存
```

### 5. 任务执行超时

**问题**：任务执行超时

**排查步骤**：
1. 检查任务复杂度
2. 检查网络延迟
3. 查看资源使用

**解决方案**：
```typescript
// 增加超时时间
timeout: 120000, // 2 分钟

// 或优化任务
// - 分解复杂任务
// - 使用异步操作
// - 优化算法
```

## 常见问题

### Q1: 如何调试 Agent 执行？

**A**: 使用监控和追踪系统：

```typescript
import { initMonitoring, getTraceCollector } from '@zhin.js/agent';

// 初始化监控
const monitoring = initMonitoring();

// 获取追踪数据
const traces = getTraceCollector();
const allSpans = traces.getAllSpans();

// 分析执行流程
for (const span of allSpans) {
  console.log(`${span.name}: ${span.status.code} (${span.endTime - span.startTime}ms)`);
}
```

### Q2: 如何优化 Token 使用？

**A**: 使用提示词构建器和缓存：

```typescript
import { PromptBuilder } from '@zhin.js/agent';

// 使用智能裁剪
const builder = new PromptBuilder({
  maxTotalChars: 50000,
});

// 缓存频繁使用的提示词
const cachedPrompt = await cache.get('system-prompt');
if (cachedPrompt) {
  return cachedPrompt;
}

const prompt = builder.build();
await cache.set('system-prompt', prompt);
```

### Q3: 如何处理安全事件？

**A**: 使用审计日志和告警系统：

```typescript
import { getAuditLogger, getAlertManager } from '@zhin.js/agent';

const auditLogger = getAuditLogger();
const alerts = getAlertManager();

// 监听安全事件
alerts.addRule({
  id: 'security-violation',
  name: 'Security Violation',
  condition: (metrics) => {
    const events = metrics.getValues('agent_security_events_total');
    return events.some(v => v.labels.type === 'violation');
  },
  severity: 'critical',
  message: 'Security violation detected',
  enabled: true,
});

// 定期审查日志
const stats = auditLogger.getStats();
console.log('Security events:', stats);
```

### Q4: 如何扩展 Agent 功能？

**A**: 使用 Agent 调度器和提示词构建器：

```typescript
import { AgentDispatcher, PromptBuilder } from '@zhin.js/agent';

// 创建自定义角色
const dispatcher = new AgentDispatcher();

// 添加自定义工具
dispatcher.addTool({
  name: 'custom_tool',
  description: 'Custom tool',
  execute: async (args) => {
    // 实现自定义逻辑
    return result;
  },
});

// 构建自定义提示词
const builder = new PromptBuilder();
const prompt = builder
  .addSystemPrompt('Custom system prompt')
  .addRoleDefinition('custom-role')
  .build();
```

## 参考资料

- [Agent Harness Engineering 指南](./agent-harness-engineering.md)（含安全策略、审计日志）
- API 参考（`pnpm docs:api` 本地生成）

## 获取帮助

如果遇到问题：

1. 查看本文档的故障排除部分
2. 检查审计日志
3. 搜索 GitHub Issues
4. 在 Discussions 中提问
