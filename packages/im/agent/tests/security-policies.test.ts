import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  AuditLogger,
  NetworkPolicy,
  BudgetLimiter,
  checkExecPolicy,
  checkFileAccess,
  checkNetworkAccess,
  checkBudgetLimit,
} from '../src/security/index.js';

describe('Agent Security Policies', () => {
  describe('AuditLogger', () => {
    let auditLogger: AuditLogger;

    beforeEach(() => {
      auditLogger = new AuditLogger({ enabled: true });
    });

    afterEach(() => {
      auditLogger.close();
    });

    it('should create audit logger', () => {
      expect(auditLogger).toBeDefined();
      expect(auditLogger.getConfig().enabled).toBe(true);
    });

    it('should log tool execution', () => {
      auditLogger.logToolExecution('bash', { command: 'ls' }, 'ok', 100);
      const events = auditLogger.getSessionEvents();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('tool.execute');
      expect(events[0].toolName).toBe('bash');
    });

    it('should log tool denied', () => {
      auditLogger.logToolDenied('bash', '危险命令', { command: 'rm -rf /' });
      const events = auditLogger.getSessionEvents();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('tool.denied');
      expect(events[0].blocked).toBe(true);
    });

    it('should log exec policy', () => {
      auditLogger.logExecPolicy('ls -la', true);
      const events = auditLogger.getSessionEvents();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('exec.policy');
      expect(events[0].blocked).toBe(false);
    });

    it('should log file access', () => {
      auditLogger.logFileAccess('/path/to/file', false, '敏感文件');
      const events = auditLogger.getSessionEvents();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('file.access');
      expect(events[0].blocked).toBe(true);
    });

    it('should log security violation', () => {
      auditLogger.logSecurityViolation('unauthorized', '尝试访问敏感文件');
      const events = auditLogger.getSessionEvents();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('security.violation');
      expect(events[0].severity).toBe('error');
    });

    it('should log owner confirm', () => {
      auditLogger.logOwnerConfirm('bash', true, '用户批准');
      const events = auditLogger.getSessionEvents();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('owner.confirm');
    });

    it('should log rate limit', () => {
      auditLogger.logRateLimit('user123', 100, 101);
      const events = auditLogger.getSessionEvents();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('rate.limit');
      expect(events[0].blocked).toBe(true);
    });

    it('should log session start and end', () => {
      auditLogger.logSessionStart('session1', 'user1', 'bot1', 'qq');
      auditLogger.logSessionEnd('session1', 1000, 5);

      const events = auditLogger.getSessionEvents();
      expect(events.length).toBe(2);
      expect(events[0].type).toBe('session.start');
      expect(events[1].type).toBe('session.end');
    });

    it('should get stats', () => {
      auditLogger.logToolExecution('bash', {}, 'ok', 100);
      auditLogger.logToolDenied('bash', 'test');
      auditLogger.logExecPolicy('ls', true);

      const stats = auditLogger.getStats();
      expect(stats.totalEvents).toBe(3);
      expect(stats.sessionEvents).toBe(3);
      expect(stats.blockedEvents).toBe(1);
      expect(stats.byType['tool.execute']).toBe(1);
      expect(stats.byType['tool.denied']).toBe(1);
      expect(stats.byType['exec.policy']).toBe(1);
    });

    it('should clear session events', () => {
      auditLogger.logToolExecution('bash', {}, 'ok', 100);
      expect(auditLogger.getSessionEvents().length).toBe(1);

      auditLogger.clearSessionEvents();
      expect(auditLogger.getSessionEvents().length).toBe(0);
    });
  });

  describe('NetworkPolicy', () => {
    let networkPolicy: NetworkPolicy;

    beforeEach(() => {
      networkPolicy = new NetworkPolicy({
        enabled: true,
        allowedDomains: ['api.openai.com', 'github.com'],
        blockedDomains: ['*.malware.com'],
        blockPrivateIPs: true,
        rateLimit: 10,
      });
    });

    it('should create network policy', () => {
      expect(networkPolicy).toBeDefined();
      expect(networkPolicy.getConfig().enabled).toBe(true);
    });

    it('should allow whitelisted domains', () => {
      const result = networkPolicy.checkUrl('https://api.openai.com/v1/chat');
      expect(result.allowed).toBe(true);
    });

    it('should block non-whitelisted domains', () => {
      const result = networkPolicy.checkUrl('https://evil.com/steal');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('不在白名单中');
    });

    it('should block blacklisted domains', () => {
      const result = networkPolicy.checkUrl('https://malware.com/evil');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('黑名单');
    });

    it('should block private IPs', () => {
      const result = networkPolicy.checkUrl('http://192.168.1.1/admin');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('私有 IP');
    });

    it('should allow localhost in development', () => {
      const devPolicy = new NetworkPolicy({
        enabled: true,
        blockPrivateIPs: false,
      });

      const result = devPolicy.checkUrl('http://localhost:3000');
      expect(result.allowed).toBe(true);
    });

    it('should block suspicious domains', () => {
      const result = networkPolicy.checkUrl('https://evil.tk/phish');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('可疑域名');
    });

    it('should enforce rate limiting', () => {
      const userId = 'user123';

      // 前 10 个请求应该通过
      for (let i = 0; i < 10; i++) {
        const result = networkPolicy.checkUrl('https://api.openai.com', userId);
        expect(result.allowed).toBe(true);
      }

      // 第 11 个请求应该被限制
      const result = networkPolicy.checkUrl('https://api.openai.com', userId);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('频繁');
    });

    it('should block dangerous protocols', () => {
      const result = networkPolicy.checkUrl('file:///etc/passwd');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('协议');
    });

    it('should block dangerous ports', () => {
      const result = networkPolicy.checkUrl('http://example.com:22');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('端口');
    });

    it('should mask sensitive URLs', () => {
      const result = networkPolicy.checkUrl('https://api.openai.com/v1/chat');
      expect(result.sanitizedUrl).toContain('***');
    });
  });

  describe('BudgetLimiter', () => {
    let budgetLimiter: BudgetLimiter;

    beforeEach(() => {
      budgetLimiter = new BudgetLimiter({
        enabled: true,
        maxTokensPerSession: 1000,
        maxCostPerSession: 1.0,
        maxToolCallsPerSession: 10,
        maxIterationsPerSession: 5,
        warningThreshold: 80,
      });
    });

    it('should create budget limiter', () => {
      expect(budgetLimiter).toBeDefined();
      expect(budgetLimiter.getConfig().enabled).toBe(true);
    });

    it('should create session', () => {
      const session = budgetLimiter.createSession('session1', 'user1');
      expect(session).toBeDefined();
      expect(session.sessionId).toBe('session1');
      expect(session.userId).toBe('user1');
    });

    it('should track token usage', () => {
      budgetLimiter.createSession('session1');

      const result = budgetLimiter.recordTokenUsage('session1', {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedCost: 0.1,
      });

      expect(result.allowed).toBe(true);
      expect(result.current?.tokens).toBe(150);
      expect(result.current?.cost).toBe(0.1);
    });

    it('should enforce token limit', () => {
      // 创建一个新的 budget limiter，设置较高的成本限制但较低的 token 限制
      const tokenLimiter = new BudgetLimiter({
        enabled: true,
        maxTokensPerSession: 1000,
        maxCostPerSession: 100.0,  // 较高的成本限制
        maxToolCallsPerSession: 100,
        maxIterationsPerSession: 100,
        warningThreshold: 80,
      });

      tokenLimiter.createSession('session1');

      // 使用超过限制的 token
      const result = tokenLimiter.recordTokenUsage('session1', {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        estimatedCost: 1.5,
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Token');
    });

    it('should enforce cost limit', () => {
      // 创建一个新的 budget limiter，设置较高的 token 限制但较低的成本限制
      const costLimiter = new BudgetLimiter({
        enabled: true,
        maxTokensPerSession: 100000,  // 较高的 token 限制
        maxCostPerSession: 1.0,
        maxToolCallsPerSession: 100,
        maxIterationsPerSession: 100,
        warningThreshold: 80,
      });

      costLimiter.createSession('session1');

      // 使用超过限制的成本
      const result = costLimiter.recordTokenUsage('session1', {
        inputTokens: 500,
        outputTokens: 500,
        totalTokens: 1000,
        estimatedCost: 2.0,
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('成本');
    });

    it('should enforce tool call limit', () => {
      // 创建一个新的 budget limiter，设置较高的 token 和成本限制
      const toolCallLimiter = new BudgetLimiter({
        enabled: true,
        maxTokensPerSession: 1000000,
        maxCostPerSession: 100.0,
        maxToolCallsPerSession: 10,
        maxIterationsPerSession: 100,
        warningThreshold: 80,
      });

      toolCallLimiter.createSession('session1');

      // 前 9 次应该通过（第 10 次会达到限制）
      for (let i = 0; i < 9; i++) {
        const result = toolCallLimiter.recordToolCall('session1');
        expect(result.allowed).toBe(true);
      }

      // 第 10 次应该被限制
      const result = toolCallLimiter.recordToolCall('session1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('工具调用');
    });

    it('should enforce iteration limit', () => {
      // 创建一个新的 budget limiter，设置较高的其他限制
      const iterationLimiter = new BudgetLimiter({
        enabled: true,
        maxTokensPerSession: 1000000,
        maxCostPerSession: 100.0,
        maxToolCallsPerSession: 100,
        maxIterationsPerSession: 5,
        warningThreshold: 80,
      });

      iterationLimiter.createSession('session1');

      // 前 4 次应该通过（第 5 次会达到限制）
      for (let i = 0; i < 4; i++) {
        const result = iterationLimiter.recordIteration('session1');
        expect(result.allowed).toBe(true);
      }

      // 第 5 次应该被限制
      const result = iterationLimiter.recordIteration('session1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('迭代');
    });

    it('should send warnings', () => {
      budgetLimiter.createSession('session1');

      // 使用 80% 以上的 token
      const result = budgetLimiter.recordTokenUsage('session1', {
        inputTokens: 800,
        outputTokens: 100,
        totalTokens: 900,
        estimatedCost: 0.9,
      });

      expect(result.allowed).toBe(true);
      expect(result.isWarning).toBe(true);
      expect(result.reason).toContain('Token');
    });

    it('should get session stats', () => {
      budgetLimiter.createSession('session1');
      budgetLimiter.recordTokenUsage('session1', {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedCost: 0.1,
      });
      budgetLimiter.recordToolCall('session1');
      budgetLimiter.recordIteration('session1');

      const stats = budgetLimiter.getSessionStats('session1');
      expect(stats).toBeDefined();
      expect(stats?.tokenUsage.totalTokens).toBe(150);
      expect(stats?.toolCallCount).toBe(1);
      expect(stats?.iterationCount).toBe(1);
    });

    it('should end session', () => {
      budgetLimiter.createSession('session1');
      const session = budgetLimiter.endSession('session1');
      expect(session).toBeDefined();
      expect(budgetLimiter.getSessionStats('session1')).toBeUndefined();
    });
  });

  describe('Exec Policy Integration', () => {
    it('should check exec policy with audit logging', () => {
      const config = {
        execSecurity: 'allowlist',
        execPreset: 'readonly',
        execAllowlist: [],
        execApprovalMode: 'deny',
      } as any;

      // 允许只读命令
      const result1 = checkExecPolicy(config, 'ls -la');
      expect(result1.allowed).toBe(true);

      // 拒绝危险命令
      const result2 = checkExecPolicy(config, 'sudo rm -rf /');
      expect(result2.allowed).toBe(false);
      expect(result2.reason).toContain('危险命令');
    });
  });

  describe('File Policy Integration', () => {
    it('should check file access with audit logging', () => {
      // 允许普通文件
      const result1 = checkFileAccess('/path/to/file.txt');
      expect(result1.allowed).toBe(true);

      // 拒绝敏感文件
      const result2 = checkFileAccess('/path/to/.env');
      expect(result2.allowed).toBe(false);
      expect(result2.reason).toContain('敏感文件');
    });
  });

  describe('Network Policy Integration', () => {
    it('should check network access', () => {
      const result = checkNetworkAccess('https://api.openai.com/v1/chat');
      expect(result.allowed).toBe(true);
    });
  });

  describe('Budget Limit Integration', () => {
    it('should check budget limit', () => {
      const result = checkBudgetLimit('session1', 'toolCall');
      expect(result.allowed).toBe(true);
    });
  });
});
