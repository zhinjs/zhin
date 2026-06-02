/**
 * Agent 监控和可观测性模块
 *
 * 提供：
 * - 性能指标收集（Prometheus 格式）
 * - 分布式追踪（OpenTelemetry 格式）
 * - 实时监控仪表板数据
 * - 告警规则配置
 */

export * from './metrics.js';

import { getMetricsCollector, getAlertManager, getTraceCollector } from './metrics.js';

// ── 监控仪表板数据 ────────────────────────────────────────────────────

export interface DashboardData {
  /** 时间戳 */
  timestamp: number;
  /** 指标数据 */
  metrics: {
    /** 工具执行统计 */
    toolExecutions: {
      total: number;
      success: number;
      failed: number;
      averageDuration: number;
    };
    /** 会话统计 */
    sessions: {
      total: number;
      active: number;
      averageDuration: number;
    };
    /** Token 使用统计 */
    tokenUsage: {
      total: number;
      input: number;
      output: number;
      estimatedCost: number;
    };
    /** 安全事件统计 */
    securityEvents: {
      total: number;
      violations: number;
      warnings: number;
    };
    /** 资源使用 */
    resourceUsage: {
      cpu: number;
      memory: number;
      activeConnections: number;
    };
  };
  /** 告警 */
  alerts: Array<{
    id: string;
    severity: string;
    message: string;
    timestamp: number;
  }>;
  /** 追踪数据 */
  traces: Array<{
    traceId: string;
    spans: number;
    duration: number;
    status: string;
  }>;
}

/**
 * 生成监控仪表板数据
 */
export function generateDashboardData(): DashboardData {
  const metrics = getMetricsCollector();
  const alerts = getAlertManager();
  const traces = getTraceCollector();

  // 获取工具执行统计
  const toolExecutions = metrics.getValues('agent_tool_executions_total');
  const toolDurations = metrics.getValues('agent_tool_execution_duration_seconds');

  const totalExecutions = toolExecutions.reduce((sum, v) => sum + v.value, 0);
  const successExecutions = toolExecutions
    .filter(v => v.labels.status === 'success')
    .reduce((sum, v) => sum + v.value, 0);
  const failedExecutions = toolExecutions
    .filter(v => v.labels.status === 'error')
    .reduce((sum, v) => sum + v.value, 0);

  const averageDuration = toolDurations.length > 0
    ? toolDurations.reduce((sum, v) => sum + v.value, 0) / toolDurations.length
    : 0;

  // 获取会话统计
  const sessions = metrics.getValues('agent_sessions_total');
  const sessionDurations = metrics.getValues('agent_session_duration_seconds');

  const totalSessions = sessions.reduce((sum, v) => sum + v.value, 0);
  const activeSessions = sessions
    .filter(v => v.labels.status === 'active')
    .reduce((sum, v) => sum + v.value, 0);

  const averageSessionDuration = sessionDurations.length > 0
    ? sessionDurations.reduce((sum, v) => sum + v.value, 0) / sessionDurations.length
    : 0;

  // 获取 Token 使用统计
  const tokenUsage = metrics.getValues('agent_token_usage_total');
  const totalTokens = tokenUsage.reduce((sum, v) => sum + v.value, 0);
  const inputTokens = tokenUsage
    .filter(v => v.labels.type === 'input')
    .reduce((sum, v) => sum + v.value, 0);
  const outputTokens = tokenUsage
    .filter(v => v.labels.type === 'output')
    .reduce((sum, v) => sum + v.value, 0);

  // 获取安全事件统计
  const securityEvents = metrics.getValues('agent_security_events_total');
  const totalSecurityEvents = securityEvents.reduce((sum, v) => sum + v.value, 0);
  const violations = securityEvents
    .filter(v => v.labels.type === 'violation')
    .reduce((sum, v) => sum + v.value, 0);
  const warnings = securityEvents
    .filter(v => v.labels.severity === 'warning')
    .reduce((sum, v) => sum + v.value, 0);

  // 获取资源使用
  const resourceUsage = metrics.getValues('agent_resource_usage');
  const cpuUsage = resourceUsage.find(v => v.labels.type === 'cpu')?.value || 0;
  const memoryUsage = resourceUsage.find(v => v.labels.type === 'memory')?.value || 0;
  const activeConnections = resourceUsage.find(v => v.labels.type === 'connections')?.value || 0;

  // 获取告警
  const activeAlerts = alerts.getAlerts().map(alert => ({
    id: alert.ruleId,
    severity: alert.severity,
    message: alert.message,
    timestamp: alert.timestamp,
  }));

  // 获取追踪数据
  const allTraces = traces.getAllSpans();
  const traceMap = new Map<string, typeof allTraces>();

  for (const span of allTraces) {
    if (!traceMap.has(span.traceId)) {
      traceMap.set(span.traceId, []);
    }
    traceMap.get(span.traceId)!.push(span);
  }

  const traceSummaries = Array.from(traceMap.entries()).map(([traceId, spans]) => {
    const startTime = Math.min(...spans.map(s => s.startTime));
    const endTime = Math.max(...spans.map(s => s.endTime || s.startTime));
    const duration = endTime - startTime;
    const hasError = spans.some(s => s.status.code === 'ERROR');

    return {
      traceId,
      spans: spans.length,
      duration,
      status: hasError ? 'ERROR' : 'OK',
    };
  });

  return {
    timestamp: Date.now(),
    metrics: {
      toolExecutions: {
        total: totalExecutions,
        success: successExecutions,
        failed: failedExecutions,
        averageDuration,
      },
      sessions: {
        total: totalSessions,
        active: activeSessions,
        averageDuration: averageSessionDuration,
      },
      tokenUsage: {
        total: totalTokens,
        input: inputTokens,
        output: outputTokens,
        estimatedCost: totalTokens * 0.000002, // 简化的成本估算
      },
      securityEvents: {
        total: totalSecurityEvents,
        violations,
        warnings,
      },
      resourceUsage: {
        cpu: cpuUsage,
        memory: memoryUsage,
        activeConnections,
      },
    },
    alerts: activeAlerts,
    traces: traceSummaries.slice(0, 10), // 只返回最近 10 个追踪
  };
}

/**
 * 监控系统健康检查
 */
export function healthCheck(): {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Array<{
    name: string;
    status: 'pass' | 'fail' | 'warn';
    message?: string;
  }>;
} {
  const checks: Array<{
    name: string;
    status: 'pass' | 'fail' | 'warn';
    message?: string;
  }> = [];

  // 检查指标收集器
  try {
    const metrics = getMetricsCollector();
    const allMetrics = metrics.getAllMetrics();
    checks.push({
      name: 'metrics_collector',
      status: allMetrics.size > 0 ? 'pass' : 'warn',
      message: `${allMetrics.size} metrics registered`,
    });
  } catch (error) {
    checks.push({
      name: 'metrics_collector',
      status: 'fail',
      message: `Failed to initialize: ${error}`,
    });
  }

  // 检查追踪收集器
  try {
    const traces = getTraceCollector();
    const allSpans = traces.getAllSpans();
    checks.push({
      name: 'trace_collector',
      status: 'pass',
      message: `${allSpans.length} spans collected`,
    });
  } catch (error) {
    checks.push({
      name: 'trace_collector',
      status: 'fail',
      message: `Failed to initialize: ${error}`,
    });
  }

  // 检查告警管理器
  try {
    const alerts = getAlertManager();
    const allAlerts = alerts.getAlerts();
    const criticalAlerts = allAlerts.filter(a => a.severity === 'critical');

    checks.push({
      name: 'alert_manager',
      status: criticalAlerts.length > 0 ? 'warn' : 'pass',
      message: `${allAlerts.length} alerts (${criticalAlerts.length} critical)`,
    });
  } catch (error) {
    checks.push({
      name: 'alert_manager',
      status: 'fail',
      message: `Failed to initialize: ${error}`,
    });
  }

  // 确定总体状态
  const hasFail = checks.some(c => c.status === 'fail');
  const hasWarn = checks.some(c => c.status === 'warn');

  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  if (hasFail) {
    status = 'unhealthy';
  } else if (hasWarn) {
    status = 'degraded';
  }

  return { status, checks };
}
