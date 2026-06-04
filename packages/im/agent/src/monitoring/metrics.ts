/**
 * Agent 监控和可观测性模块
 *
 * 提供：
 * - 性能指标收集（Prometheus 格式）
 * - 分布式追踪（OpenTelemetry 格式）
 * - 实时监控仪表板数据
 * - 告警规则配置
 */

// ── 指标类型定义 ──────────────────────────────────────────────────────

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

export interface MetricLabels {
  [key: string]: string;
}

export interface MetricValue {
  value: number;
  labels: MetricLabels;
  timestamp?: number;
}

export interface MetricDefinition {
  name: string;
  type: MetricType;
  help: string;
  labels?: string[];
}

// ── 指标收集器 ────────────────────────────────────────────────────────

export class MetricsCollector {
  private metrics: Map<string, MetricDefinition> = new Map();
  private values: Map<string, MetricValue[]> = new Map();
  private static readonly MAX_HISTOGRAM_SAMPLES = 500;

  /**
   * 注册指标
   */
  register(definition: MetricDefinition): void {
    this.metrics.set(definition.name, definition);
    if (!this.values.has(definition.name)) {
      this.values.set(definition.name, []);
    }
  }

  /**
   * 增加计数器
   */
  increment(name: string, labels: MetricLabels = {}, value: number = 1): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== 'counter') {
      throw new Error(`Metric ${name} is not a counter`);
    }

    const key = this.buildKey(name, labels);
    const values = this.values.get(name) || [];
    const existing = values.find(v => this.buildKey(name, v.labels) === key);

    if (existing) {
      existing.value += value;
      existing.timestamp = Date.now();
    } else {
      values.push({
        value,
        labels,
        timestamp: Date.now(),
      });
    }

    this.values.set(name, values);
  }

  /**
   * 设置仪表盘值
   */
  set(name: string, value: number, labels: MetricLabels = {}): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== 'gauge') {
      throw new Error(`Metric ${name} is not a gauge`);
    }

    const key = this.buildKey(name, labels);
    const values = this.values.get(name) || [];
    const existing = values.find(v => this.buildKey(name, v.labels) === key);

    if (existing) {
      existing.value = value;
      existing.timestamp = Date.now();
    } else {
      values.push({
        value,
        labels,
        timestamp: Date.now(),
      });
    }

    this.values.set(name, values);
  }

  /**
   * 记录直方图值
   */
  observe(name: string, value: number, labels: MetricLabels = {}): void {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== 'histogram' && metric.type !== 'summary') {
      throw new Error(`Metric ${name} is not a histogram or summary`);
    }

    const values = this.values.get(name) || [];
    values.push({
      value,
      labels,
      timestamp: Date.now(),
    });
    this.trimHistogramSamples(values);

    this.values.set(name, values);
  }

  private trimHistogramSamples(values: MetricValue[]): void {
    if (values.length <= MetricsCollector.MAX_HISTOGRAM_SAMPLES) return;
    values.splice(0, values.length - MetricsCollector.MAX_HISTOGRAM_SAMPLES);
  }

  /**
   * 获取指标值
   */
  getValues(name: string): MetricValue[] {
    return this.values.get(name) || [];
  }

  /**
   * 获取所有指标
   */
  getAllMetrics(): Map<string, MetricDefinition> {
    return new Map(this.metrics);
  }

  /**
   * 导出 Prometheus 格式
   */
  toPrometheus(): string {
    const lines: string[] = [];

    for (const [name, definition] of this.metrics.entries()) {
      const values = this.values.get(name) || [];

      // 添加 HELP 和 TYPE
      lines.push(`# HELP ${name} ${definition.help}`);
      lines.push(`# TYPE ${name} ${definition.type}`);

      // 添加值
      for (const value of values) {
        const labelsStr = Object.entries(value.labels)
          .map(([key, val]) => `${key}="${val}"`)
          .join(',');

        const metricLine = labelsStr
          ? `${name}{${labelsStr}} ${value.value}`
          : `${name} ${value.value}`;

        lines.push(metricLine);
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 构建指标键
   */
  private buildKey(name: string, labels: MetricLabels): string {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${key}=${val}`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }
}

// ── 预定义指标 ────────────────────────────────────────────────────────

export const AGENT_METRICS = {
  // 工具执行指标
  TOOL_EXECUTIONS: {
    name: 'agent_tool_executions_total',
    type: 'counter' as MetricType,
    help: 'Total number of tool executions',
    labels: ['tool', 'status', 'platform'],
  },
  TOOL_EXECUTION_DURATION: {
    name: 'agent_tool_execution_duration_seconds',
    type: 'histogram' as MetricType,
    help: 'Tool execution duration in seconds',
    labels: ['tool', 'platform'],
  },

  // Agent 会话指标
  AGENT_SESSIONS: {
    name: 'agent_sessions_total',
    type: 'counter' as MetricType,
    help: 'Total number of agent sessions',
    labels: ['platform', 'status'],
  },
  AGENT_SESSION_DURATION: {
    name: 'agent_session_duration_seconds',
    type: 'histogram' as MetricType,
    help: 'Agent session duration in seconds',
    labels: ['platform'],
  },

  // Token 使用指标
  TOKEN_USAGE: {
    name: 'agent_token_usage_total',
    type: 'counter' as MetricType,
    help: 'Total token usage',
    labels: ['type', 'model', 'platform'],
  },

  // 安全事件指标
  SECURITY_EVENTS: {
    name: 'agent_security_events_total',
    type: 'counter' as MetricType,
    help: 'Total security events',
    labels: ['type', 'severity', 'platform'],
  },

  // 资源使用指标
  RESOURCE_USAGE: {
    name: 'agent_resource_usage',
    type: 'gauge' as MetricType,
    help: 'Resource usage',
    labels: ['type'],
  },

  // 错误指标
  ERRORS: {
    name: 'agent_errors_total',
    type: 'counter' as MetricType,
    help: 'Total errors',
    labels: ['type', 'platform'],
  },
};

// ── 追踪 Span 定义 ───────────────────────────────────────────────────

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, unknown>;
  events: Array<{
    name: string;
    timestamp: number;
    attributes: Record<string, unknown>;
  }>;
  status: {
    code: 'OK' | 'ERROR' | 'UNSET';
    message?: string;
  };
}

// ── 追踪收集器 ────────────────────────────────────────────────────────

export class TraceCollector {
  private spans: Map<string, TraceSpan> = new Map();
  private activeSpans: Map<string, TraceSpan> = new Map();
  private static readonly MAX_SPANS = 2000;

  /**
   * 开始一个新的 Span
   */
  startSpan(
    name: string,
    parentSpanId?: string,
    attributes: Record<string, unknown> = {},
  ): TraceSpan {
    // 如果有父 Span，继承其 traceId
    let traceId = this.generateTraceId();
    if (parentSpanId) {
      const parentSpan = this.spans.get(parentSpanId);
      if (parentSpan) {
        traceId = parentSpan.traceId;
      }
    }

    const spanId = this.generateSpanId();

    const span: TraceSpan = {
      traceId,
      spanId,
      parentSpanId,
      name,
      startTime: Date.now(),
      attributes,
      events: [],
      status: { code: 'UNSET' },
    };

    this.spans.set(spanId, span);
    this.activeSpans.set(spanId, span);

    return span;
  }

  /**
   * 结束 Span
   */
  endSpan(spanId: string, status?: { code: 'OK' | 'ERROR' | 'UNSET'; message?: string }): void {
    const span = this.activeSpans.get(spanId);
    if (!span) {
      return;
    }

    span.endTime = Date.now();
    if (status) {
      span.status = status;
    }

    this.activeSpans.delete(spanId);
    this.pruneFinishedSpans();
  }

  private pruneFinishedSpans(): void {
    if (this.spans.size <= TraceCollector.MAX_SPANS) return;
    const finished = [...this.spans.entries()]
      .filter(([, span]) => span.endTime != null)
      .sort((a, b) => (a[1].endTime ?? 0) - (b[1].endTime ?? 0));
    const excess = this.spans.size - TraceCollector.MAX_SPANS;
    for (let i = 0; i < excess && i < finished.length; i++) {
      this.spans.delete(finished[i][0]);
    }
  }

  /**
   * 添加事件到 Span
   */
  addEvent(
    spanId: string,
    name: string,
    attributes: Record<string, unknown> = {},
  ): void {
    const span = this.activeSpans.get(spanId);
    if (!span) {
      return;
    }

    span.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
  }

  /**
   * 设置 Span 属性
   */
  setAttributes(spanId: string, attributes: Record<string, unknown>): void {
    const span = this.activeSpans.get(spanId);
    if (!span) {
      return;
    }

    Object.assign(span.attributes, attributes);
  }

  /**
   * 获取 Span
   */
  getSpan(spanId: string): TraceSpan | undefined {
    return this.spans.get(spanId);
  }

  /**
   * 获取所有 Span
   */
  getAllSpans(): TraceSpan[] {
    return Array.from(this.spans.values());
  }

  /**
   * 获取追踪
   */
  getTrace(traceId: string): TraceSpan[] {
    return Array.from(this.spans.values()).filter(s => s.traceId === traceId);
  }

  /**
   * 导出 OpenTelemetry 格式
   */
  toOpenTelemetry(): object {
    const spans = Array.from(this.spans.values());

    return {
      resourceSpans: [{
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'zhin-agent' } },
            { key: 'service.version', value: { stringValue: '1.0.0' } },
          ],
        },
        instrumentationLibrarySpans: [{
          instrumentationLibrary: {
            name: 'zhin-agent',
            version: '1.0.0',
          },
          spans: spans.map(span => ({
            traceId: span.traceId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            name: span.name,
            startTimeUnixNano: span.startTime * 1000000,
            endTimeUnixNano: span.endTime ? span.endTime * 1000000 : undefined,
            attributes: Object.entries(span.attributes).map(([key, value]) => ({
              key,
              value: { stringValue: String(value) },
            })),
            events: span.events.map(event => ({
              name: event.name,
              timeUnixNano: event.timestamp * 1000000,
              attributes: Object.entries(event.attributes).map(([key, value]) => ({
                key,
                value: { stringValue: String(value) },
              })),
            })),
            status: {
              code: span.status.code === 'OK' ? 1 : span.status.code === 'ERROR' ? 2 : 0,
              message: span.status.message,
            },
          })),
        }],
      }],
    };
  }

  /**
   * 生成 Trace ID
   */
  private generateTraceId(): string {
    return Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }

  /**
   * 生成 Span ID
   */
  private generateSpanId(): string {
    return Array.from({ length: 16 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }
}

// ── 告警规则 ──────────────────────────────────────────────────────────

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  condition: (metrics: MetricsCollector) => boolean;
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  enabled: boolean;
}

export class AlertManager {
  private rules: Map<string, AlertRule> = new Map();
  private alerts: Array<{
    ruleId: string;
    timestamp: number;
    message: string;
    severity: string;
  }> = [];

  /**
   * 添加告警规则
   */
  addRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * 移除告警规则
   */
  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  /**
   * 检查告警
   */
  checkAlerts(metrics: MetricsCollector): Array<{
    ruleId: string;
    timestamp: number;
    message: string;
    severity: string;
  }> {
    const newAlerts: Array<{
      ruleId: string;
      timestamp: number;
      message: string;
      severity: string;
    }> = [];

    for (const [ruleId, rule] of this.rules.entries()) {
      if (!rule.enabled) {
        continue;
      }

      try {
        if (rule.condition(metrics)) {
          const alert = {
            ruleId,
            timestamp: Date.now(),
            message: rule.message,
            severity: rule.severity,
          };

          this.alerts.push(alert);
          newAlerts.push(alert);
        }
      } catch (error) {
        console.error(`[AlertManager] Rule ${ruleId} evaluation failed:`, error);
      }
    }

    return newAlerts;
  }

  /**
   * 获取所有告警
   */
  getAlerts(): Array<{
    ruleId: string;
    timestamp: number;
    message: string;
    severity: string;
  }> {
    return [...this.alerts];
  }

  /**
   * 清除告警
   */
  clearAlerts(): void {
    this.alerts = [];
  }
}

// ── 预定义告警规则 ────────────────────────────────────────────────────

export const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
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
  },
  {
    id: 'high-token-usage',
    name: 'High Token Usage',
    description: 'Token usage exceeds threshold',
    condition: (metrics) => {
      const tokens = metrics.getValues('agent_token_usage_total');
      const total = tokens.reduce((sum, v) => sum + v.value, 0);
      return total > 1000000;
    },
    severity: 'warning',
    message: 'High token usage detected',
    enabled: true,
  },
  {
    id: 'security-violations',
    name: 'Security Violations',
    description: 'Security violations detected',
    condition: (metrics) => {
      const events = metrics.getValues('agent_security_events_total');
      const violations = events.filter(v => v.labels.type === 'violation');
      return violations.length > 0;
    },
    severity: 'critical',
    message: 'Security violations detected',
    enabled: true,
  },
];

// ── 全局实例 ──────────────────────────────────────────────────────────

let globalMetricsCollector: MetricsCollector | null = null;
let globalTraceCollector: TraceCollector | null = null;
let globalAlertManager: AlertManager | null = null;

/**
 * 获取全局指标收集器
 */
export function getMetricsCollector(): MetricsCollector {
  if (!globalMetricsCollector) {
    globalMetricsCollector = new MetricsCollector();

    // 注册预定义指标
    for (const metric of Object.values(AGENT_METRICS)) {
      globalMetricsCollector.register(metric);
    }
  }
  return globalMetricsCollector;
}

/**
 * 获取全局追踪收集器
 */
export function getTraceCollector(): TraceCollector {
  if (!globalTraceCollector) {
    globalTraceCollector = new TraceCollector();
  }
  return globalTraceCollector;
}

/**
 * 获取全局告警管理器
 */
export function getAlertManager(): AlertManager {
  if (!globalAlertManager) {
    globalAlertManager = new AlertManager();

    // 添加预定义告警规则
    for (const rule of DEFAULT_ALERT_RULES) {
      globalAlertManager.addRule(rule);
    }
  }
  return globalAlertManager;
}

/**
 * 初始化监控系统
 */
export function initMonitoring(): {
  metrics: MetricsCollector;
  traces: TraceCollector;
  alerts: AlertManager;
} {
  return {
    metrics: getMetricsCollector(),
    traces: getTraceCollector(),
    alerts: getAlertManager(),
  };
}
