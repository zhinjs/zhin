# Agent Harness Engineering 指南

本文档描述了 zhin.js Agent 的 harness engineering 实践，提供多层安全防护。

## 概述

Agent harness engineering 是通过自动化工具和策略来强制执行 AI Agent 安全约束的实践。在 zhin.js 中，我们实现了以下安全层：

1. **执行策略** — 命令执行安全检查
2. **文件策略** — 文件访问安全检查
3. **网络策略** — 网络访问安全检查
4. **预算限制** — 资源使用限制
5. **审计日志** — 安全事件追踪
6. **沙箱环境** — 进程隔离和资源限制

此外，我们还提供了：
- **Agent 调度器** — 角色管理和工具权限控制
- **提示词构建器** — 分层提示词组装

## 快速开始

### 初始化安全策略

```typescript
import { initSecurityPolicies } from '@zhin.js/agent';

// 使用默认配置
const policies = initSecurityPolicies();

// 或使用自定义配置
const policies = initSecurityPolicies({
  audit: {
    enabled: true,
    logFile: 'data/audit/agent-audit.log',
    minSeverity: 'info',
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
  },
});
```

### 使用安全策略

```typescript
import { 
  checkExecPolicy, 
  checkFileAccess, 
  checkNetworkAccess,
  checkBudgetLimit,
  getAuditLogger 
} from '@zhin.js/agent';

// 检查命令执行权限
const execResult = checkExecPolicy(config, 'ls -la');
if (!execResult.allowed) {
  console.error('命令被拒绝:', execResult.reason);
}

// 检查文件访问权限
const fileResult = checkFileAccess('/path/to/file');
if (!fileResult.allowed) {
  console.error('文件访问被拒绝:', fileResult.reason);
}

// 检查网络访问权限
const networkResult = checkNetworkAccess('https://api.openai.com/v1/chat');
if (!networkResult.allowed) {
  console.error('网络访问被拒绝:', networkResult.reason);
}

// 记录预算使用
const budgetResult = checkBudgetLimit(sessionId, 'tokens', {
  inputTokens: 100,
  outputTokens: 50,
  totalTokens: 150,
  estimatedCost: 0.001,
});
if (!budgetResult.allowed) {
  console.error('预算超限:', budgetResult.reason);
}
```

## 安全策略详解

### 1. 执行策略 (Exec Policy)

#### 防御层级

1. **危险命令黑名单** — 即使在 `full` 模式下也阻止的命令
   - 提权命令: `sudo`, `su`, `doas`
   - Shell 元命令: `eval`, `exec`
   - 系统破坏命令: `dd`, `mkfs`, `fdisk`
   - 进程注入命令: `gdb`, `strace`, `ptrace`

2. **环境变量前缀剥离** — `FOO=bar cmd` → 按 `cmd` 检查

3. **Safe wrapper 剥离** — `timeout 10 cmd` → 按 `cmd` 检查

4. **复合命令拆分** — `&&`, `||`, `;` 逐段独立检查

5. **只读命令自动放行** — 搜索/读取/列出命令自动允许

#### 安全模式

```typescript
// 拒绝所有命令
execSecurity: 'deny'

// 仅允许白名单命令
execSecurity: 'allowlist'
execPreset: 'readonly' | 'network' | 'development'
execAllowlist: ['git', 'npm', 'pnpm']

// 允许所有命令（除危险命令）
execSecurity: 'full'
```

#### Owner 确认机制

当 `execApprovalMode: ask` 时，不在白名单的命令会触发 Owner 确认：

```typescript
// 命令返回 ZHIN_NEEDS_OWNER 信号
ZHIN_NEEDS_OWNER:
⚠️ 命令「rm -rf /tmp/test」不在允许列表中，需要用户确认后执行。

此 shell 命令需 Bot Owner 审批后方可执行。
```

### 2. 文件策略 (File Policy)


#### 防御层级

1. **设备路径阻止** — 阻止 `/dev/zero`, `/dev/stdin` 等挂起进程的设备文件

2. **敏感文件名模式** — 阻止 `.env`, `.pem`, `.key` 等敏感文件

3. **敏感目录** — 阻止 `.ssh`, `.gnupg`, `.aws` 等敏感目录

4. **bash 安全分类** — 检测环境变量泄漏和敏感文件读取

#### 文件大小限制

```typescript
MAX_READ_FILE_SIZE = 256 * 1024 * 1024  // 256 MiB
MAX_EDIT_FILE_SIZE = 1024 * 1024 * 1024 // 1 GiB
```

### 3. 网络策略 (Network Policy)

控制 AI Agent 的网络请求，防止数据外泄和 SSRF 攻击。

#### 功能特性

- **域名白名单/黑名单** — 控制可访问的域名
- **私有 IP 阻止** — 阻止访问内网地址
- **协议限制** — 禁止 `file`, `ftp`, `gopher` 等协议
- **端口限制** — 禁止访问敏感端口（如 SSH 22, 数据库 3306）
- **速率限制** — 控制请求频率
- **大小限制** — 控制请求和响应大小

#### 配置示例

```typescript
network: {
  enabled: true,
  allowedDomains: ['api.openai.com', 'github.com'],
  blockedDomains: ['*.malware.com', 'pastebin.com'],
  blockPrivateIPs: true,
  maxRequestSize: 10 * 1024 * 1024,  // 10MB
  maxResponseSize: 50 * 1024 * 1024, // 50MB
  requestTimeout: 30000,             // 30 秒
  rateLimit: 100,                    // 每分钟 100 次
  blockedProtocols: ['file', 'ftp', 'gopher'],
  blockedPorts: [22, 23, 25, 465, 587, 1080, 3306, 5432],
}
```

### 4. 预算限制 (Budget Limiter)

控制 AI Agent 的资源使用，防止 Token 滥用和成本超支。

#### 限制类型

- **Token 限制** — 每会话/每用户每天的 Token 使用量
- **成本限制** — 每会话/每用户每天的估算成本
- **调用限制** — 每会话的工具调用次数
- **迭代限制** — 每会话的迭代次数
- **时长限制** — 每会话的持续时间

#### 配置示例

```typescript
budget: {
  enabled: true,
  maxTokensPerSession: 1000000,      // 1M tokens
  maxTokensPerUserPerDay: 5000000,   // 5M tokens
  maxCostPerSession: 10.0,           // $10
  maxCostPerUserPerDay: 50.0,        // $50
  maxToolCallsPerSession: 100,
  maxIterationsPerSession: 20,
  maxSessionDuration: 3600000,       // 1 小时
  warningThreshold: 80,              // 80% 时警告
  autoTerminate: false,              // 不自动终止
}
```

### 5. 审计日志 (Audit Logger)

记录所有安全事件，用于安全审计和问题排查。

#### 事件类型

- `tool.execute` — 工具执行
- `tool.denied` — 工具被拒绝
- `tool.approval` — 工具需要审批
- `exec.policy` — 命令执行策略检查
- `file.access` — 文件访问检查
- `security.violation` — 安全违规
- `owner.confirm` — Owner 确认
- `rate.limit` — 速率限制
- `session.start` — 会话开始
- `session.end` — 会话结束

#### 日志格式

```json
{
  "id": "evt_1234567890_1",
  "type": "exec.policy",
  "severity": "warn",
  "timestamp": 1234567890000,
  "sessionId": "session_abc123",
  "userId": "user_xyz",
  "botId": "bot_001",
  "platform": "qq",
  "command": "rm -rf /tmp/test",
  "message": "命令被拒绝: 命令「rm」不在允许列表中",
  "blocked": true,
  "blockReason": "命令「rm」不在允许列表中"
}
```

#### 配置示例

```typescript
audit: {
  enabled: true,
  logFile: 'data/audit/agent-audit.log',
  minSeverity: 'info',        // info | warn | error | critical
  logSensitiveData: false,    // 生产环境不记录敏感数据
  retentionDays: 90,          // 保留 90 天
  maxFileSizeMB: 200,         // 最大 200MB
}
```

## 环境配置

### 生产环境

```typescript
import { getSecurityConfigForEnvironment } from '@zhin.js/agent';

const config = getSecurityConfigForEnvironment('production');
```

特点：
- 严格的安全策略
- 完整的审计日志
- 严格的网络限制
- 严格的预算限制

### 开发环境

```typescript
const config = getSecurityConfigForEnvironment('development');
```

特点：
- 宽松的安全策略
- 记录敏感数据（便于调试）
- 允许更多域名
- 更高的预算限制

### 最小配置

```typescript
const config = getSecurityConfigForEnvironment('minimal');
```

特点：
- 仅启用基本安全检查
- 适用于受信任环境

## 最佳实践

### 1. 分层防御

不要依赖单一安全层，而是组合使用多个安全策略：

```typescript
// 1. 检查执行策略
const execResult = checkExecPolicy(config, command);
if (!execResult.allowed) return execResult;

// 2. 检查文件访问（如果命令涉及文件）
if (involvesFile(command)) {
  const fileResult = checkFileAccess(filePath);
  if (!fileResult.allowed) return fileResult;
}

// 3. 检查网络访问（如果命令涉及网络）
if (involvesNetwork(command)) {
  const networkResult = checkNetworkAccess(url);
  if (!networkResult.allowed) return networkResult;
}

// 4. 记录预算使用
const budgetResult = checkBudgetLimit(sessionId, 'toolCall');
if (!budgetResult.allowed) return budgetResult;
```

### 2. 审计日志

始终启用审计日志，特别是在生产环境：

```typescript
const auditLogger = getAuditLogger();

// 记录工具执行
auditLogger.logToolExecution(toolName, args, result, duration);

// 记录安全事件
auditLogger.logSecurityViolation('unauthorized_access', '用户尝试访问敏感文件');

// 记录 Owner 确认
auditLogger.logOwnerConfirm(toolName, approved, message);
```

### 3. 渐进式安全

根据环境调整安全级别：

```typescript
function getSecurityLevel(): 'strict' | 'moderate' | 'relaxed' {
  const env = process.env.NODE_ENV;
  if (env === 'production') return 'strict';
  if (env === 'staging') return 'moderate';
  return 'relaxed';
}
```

### 4. 定期审查

定期审查审计日志和安全配置：

```typescript
// 获取审计统计
const stats = auditLogger.getStats();
console.log('安全事件统计:', stats);

// 检查预算使用
const sessionStats = budgetLimiter.getSessionStats(sessionId);
console.log('会话预算使用:', sessionStats);
```


## 故障排除

### 命令被拒绝

**问题**: 命令被 exec policy 拒绝

**解决方案**:
1. 检查 `execSecurity` 配置
2. 将命令添加到 `execAllowlist`
3. 使用 `execPreset: 'development'`
4. 设置 `execApprovalMode: ask` 以触发 Owner 确认

### 文件访问被拒绝

**问题**: 文件访问被 file policy 拒绝

**解决方案**:
1. 检查文件路径是否包含敏感目录
2. 检查文件名是否匹配敏感模式
3. 使用相对路径而非绝对路径

### 网络访问被拒绝

**问题**: 网络访问被 network policy 拒绝

**解决方案**:
1. 将域名添加到 `allowedDomains`
2. 检查是否访问了私有 IP
3. 检查是否使用了禁止的协议或端口

### 预算超限

**问题**: 预算限制被触发

**解决方案**:
1. 增加预算限制
2. 优化 Token 使用
3. 减少工具调用次数
4. 分割会话

## 高级功能

### 6. 沙箱环境 (Sandbox)

沙箱环境提供进程级隔离和资源限制，防止恶意命令破坏系统。

#### 功能特性

- **进程隔离** — 命令在独立子进程中执行
- **资源限制** — 限制 CPU、内存、执行时间
- **文件系统隔离** — 限制命令只能在指定工作目录下执行
- **环境变量清理** — 移除敏感环境变量
- **危险命令检测** — 阻止恶意命令模式

#### 配置示例

```typescript
import { Sandbox } from '@zhin.js/agent';

const sandbox = new Sandbox({
  enabled: true,
  workingDirectory: '/safe/workspace',
  timeout: 30000,
  maxMemoryMB: 512,
  maxOutputSize: 10 * 1024 * 1024,  // 10MB
  blockedEnvVars: [
    'AWS_SECRET_ACCESS_KEY',
    'AWS_ACCESS_KEY_ID',
    'SSH_AUTH_SOCK',
  ],
});
```

#### 使用示例

```typescript
const result = await sandbox.execute('ls -la', {
  cwd: '/safe/workspace',
  timeout: 5000,
});

if (result.blocked) {
  console.error('命令被阻止:', result.blockReason);
} else if (result.timedOut) {
  console.error('命令执行超时');
} else if (result.success) {
  console.log('输出:', result.stdout);
}
```

### 7. Agent 调度器 (Agent Dispatcher)

Agent 调度器提供角色管理和工具权限控制，实现精细化的 Agent 管理。

#### 预定义角色

| 角色 | 描述 | 可发送消息 | 可 spawn 子 Agent | 可写文件 |
|------|------|-----------|-------------------|---------|
| main | 主 Agent | ✅ | ✅ | ✅ |
| subtask | 子任务 Agent | ❌ | ❌ | ✅ |
| worker | 工作 Agent | ❌ | ❌ | ✅ |
| researcher | 研究 Agent | ❌ | ❌ | ❌ |
| executor | 执行 Agent | ❌ | ❌ | ✅ |
| reviewer | 审查 Agent | ❌ | ❌ | ❌ |
| planner | 规划 Agent | ❌ | ❌ | ❌ |

#### 使用示例

```typescript
import { AgentDispatcher } from '@zhin.js/agent';

const dispatcher = new AgentDispatcher();

// 创建任务
const task = dispatcher.createTask({
  name: 'Analyze Codebase',
  description: 'Analyze the TypeScript codebase',
  role: 'researcher',
  goal: 'Find all TypeScript files and analyze their structure',
  priority: 'high',
});

// 过滤工具
const allowedTools = dispatcher.filterToolsByRole(tools, 'researcher');

// 构建角色提示词
const prompt = dispatcher.buildRolePrompt('researcher', task);
```

### 8. 提示词构建器 (Prompt Builder)

提示词构建器提供分层提示词组装，支持优先级排序和字符数截断。

#### 提示词层级

| 层级 | 优先级 | 可截断 | 说明 |
|------|--------|--------|------|
| system | 100 | ❌ | 系统级提示词 |
| role | 90 | ❌ | 角色定义 |
| safety | 95 | ❌ | 安全规则 |
| task | 80 | ✅ | 任务描述 |
| context | 70 | ✅ | 上下文信息 |
| tools | 60 | ✅ | 工具说明 |
| constraints | 50 | ✅ | 约束条件 |
| examples | 40 | ✅ | 示例 |
| memory | 30 | ✅ | 记忆 |

#### 使用示例

```typescript
import { PromptBuilder } from '@zhin.js/agent';

const builder = new PromptBuilder({
  maxTotalChars: 100000,
  enableSafetyRules: true,
  enableConstraints: true,
});

const prompt = builder
  .addSystemPrompt('You are a helpful assistant.')
  .addRoleDefinition('main')
  .addTaskDescription({
    name: 'User Task',
    description: 'Help the user',
    goal: 'Complete the task successfully',
  })
  .addSafetyRules()
  .addConstraints()
  .addContext({
    cwd: process.cwd(),
    platform: process.platform,
  })
  .build();
```

#### 快速构建函数

```typescript
import {
  buildMainAgentPrompt,
  buildSubAgentPrompt,
  buildWorkerPrompt
} from '@zhin.js/agent';

// 主 Agent 提示词
const mainPrompt = buildMainAgentPrompt({
  role: 'You are a coding assistant.',
  task: 'Help me write code.',
  tools: [{ name: 'bash', description: 'Execute commands' }],
});

// 子 Agent 提示词
const subPrompt = buildSubAgentPrompt({
  task: 'Analyze the codebase',
  goal: 'Find all TypeScript files',
});

// 工作 Agent 提示词
const workerPrompt = buildWorkerPrompt({
  task: 'Process data',
  goal: 'Transform JSON to CSV',
});
```

## 与 Claude Code 的对比

| 特性 | Zhin Agent |
|------|-------------|------------|
| 命令执行策略 |✅ 5 层防御 |
| 文件访问控制 | ✅ 4 层防御 |
| 网络访问控制 |  ✅ 域名白名单 |
| 预算限制 | ✅ Token/Cost |
| 审计日志 | ✅ 完整日志 |
| 沙箱化执行 | ✅ 进程隔离 + 资源限制 |
| Agent 调度 | ✅ 7 种预定义角色 |
| 提示词组装 | ✅ 分层结构 + 优先级 |
| Owner 确认 | ✅ 用户确认 |
| 权限级别 | ✅ 细粒度 |

## 参考资料

- [Claude Code Harness Engineering](https://docs.anthropic.com/claude-code)
- [OWASP AI Security](https://owasp.org/www-project-ai-security/)
- [NIST AI Risk Management](https://www.nist.gov/artificial-intelligence)

## 获取帮助

如果遇到安全策略问题：

1. 查看本文档的故障排除部分
2. 检查审计日志
3. 搜索 GitHub Issues
4. 在 Discussions 中提问
