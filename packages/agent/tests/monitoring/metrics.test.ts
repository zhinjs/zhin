import { describe, it, expect, beforeEach } from 'vitest';
import {
  MetricsCollector,
  TraceCollector,
  AlertManager,
  initMonitoring,
  generateDashboardData,
  healthCheck,
  AGENT_METRICS,
  DEFAULT_ALERT_RULES,
} from '../../src/monitoring/index.js';

describe('Monitoring System', () => {
  describe('MetricsCollector', () => {
    let collector: MetricsCollector;

    beforeEach(() => {
      collector = new MetricsCollector();
    });

    it('should create collector', () => {
      expect(collector).toBeDefined();
    });

    it('should register metric', () => {
      collector.register({
        name: 'test_metric',
        type: 'counter',
        help: 'Test metric',
      });

      const metrics = collector.getAllMetrics();
      expect(metrics.has('test_metric')).toBe(true);
    });

    it('should increment counter', () => {
      collector.register({
        name: 'test_counter',
        type: 'counter',
        help: 'Test counter',
      });

      collector.increment('test_counter', { label: 'value' });
      collector.increment('test_counter', { label: 'value' });

      const values = collector.getValues('test_counter');
      expect(values.length).toBe(1);
      expect(values[0].value).toBe(2);
    });

    it('should set gauge', () => {
      collector.register({
        name: 'test_gauge',
        type: 'gauge',
        help: 'Test gauge',
      });

      collector.set('test_gauge', 42, { label: 'value' });

      const values = collector.getValues('test_gauge');
      expect(values.length).toBe(1);
      expect(values[0].value).toBe(42);
    });

    it('should observe histogram', () => {
      collector.register({
        name: 'test_histogram',
        type: 'histogram',
        help: 'Test histogram',
      });

      collector.observe('test_histogram', 0.5, { label: 'value' });
      collector.observe('test_histogram', 1.5, { label: 'value' });

      const values = collector.getValues('test_histogram');
      expect(values.length).toBe(2);
    });

    it('should export prometheus format', () => {
      collector.register({
        name: 'test_metric',
        type: 'counter',
        help: 'Test metric',
      });

      collector.increment('test_metric', { label: 'value' });

      const prometheus = collector.toPrometheus();
      expect(prometheus).toContain('# HELP test_metric Test metric');
      expect(prometheus).toContain('# TYPE test_metric counter');
      expect(prometheus).toContain('test_metric{label="value"} 1');
    });
  });

  describe('TraceCollector', () => {
    let collector: TraceCollector;

    beforeEach(() => {
      collector = new TraceCollector();
    });

    it('should create collector', () => {
      expect(collector).toBeDefined();
    });

    it('should start and end span', () => {
      const span = collector.startSpan('test-span');
      expect(span.traceId).toBeDefined();
      expect(span.spanId).toBeDefined();
      expect(span.name).toBe('test-span');

      collector.endSpan(span.spanId, { code: 'OK' });

      const endedSpan = collector.getSpan(span.spanId);
      expect(endedSpan?.endTime).toBeDefined();
      expect(endedSpan?.status.code).toBe('OK');
    });

    it('should create child span', () => {
      const parentSpan = collector.startSpan('parent');
      const childSpan = collector.startSpan('child', parentSpan.spanId);

      expect(childSpan.parentSpanId).toBe(parentSpan.spanId);
      expect(childSpan.traceId).toBe(parentSpan.traceId);
    });

    it('should add events to span', () => {
      const span = collector.startSpan('test-span');

      collector.addEvent(span.spanId, 'test-event', { key: 'value' });

      const endedSpan = collector.getSpan(span.spanId);
      expect(endedSpan?.events.length).toBe(1);
      expect(endedSpan?.events[0].name).toBe('test-event');
    });

    it('should get trace', () => {
      const span1 = collector.startSpan('span1');
      const span2 = collector.startSpan('span2', span1.spanId);

      const trace = collector.getTrace(span1.traceId);
      expect(trace.length).toBe(2);
    });

    it('should export opentelemetry format', () => {
      const span = collector.startSpan('test-span');
      collector.endSpan(span.spanId, { code: 'OK' });

      const otel = collector.toOpenTelemetry();
      expect(otel).toBeDefined();
      expect((otel as any).resourceSpans).toBeDefined();
    });
  });

  describe('AlertManager', () => {
    let manager: AlertManager;

    beforeEach(() => {
      manager = new AlertManager();
    });

    it('should create manager', () => {
      expect(manager).toBeDefined();
    });

    it('should add and remove rules', () => {
      const rule = {
        id: 'test-rule',
        name: 'Test Rule',
        description: 'Test rule',
        condition: () => true,
        severity: 'warning' as const,
        message: 'Test alert',
        enabled: true,
      };

      manager.addRule(rule);
      manager.removeRule('test-rule');
    });

    it('should check alerts', () => {
      const collector = new MetricsCollector();
      collector.register({
        name: 'test_metric',
        type: 'counter',
        help: 'Test metric',
      });

      manager.addRule({
        id: 'test-rule',
        name: 'Test Rule',
        description: 'Test rule',
        condition: (metrics) => {
          const values = metrics.getValues('test_metric');
          return values.some(v => v.value > 10);
        },
        severity: 'warning',
        message: 'Test alert',
        enabled: true,
      });

      // 不触发告警
      collector.increment('test_metric');
      let alerts = manager.checkAlerts(collector);
      expect(alerts.length).toBe(0);

      // 触发告警
      collector.increment('test_metric', {}, 20);
      alerts = manager.checkAlerts(collector);
      expect(alerts.length).toBe(1);
    });

    it('should get alerts', () => {
      manager.addRule({
        id: 'test-rule',
        name: 'Test Rule',
        description: 'Test rule',
        condition: () => true,
        severity: 'warning',
        message: 'Test alert',
        enabled: true,
      });

      const collector = new MetricsCollector();
      manager.checkAlerts(collector);

      const alerts = manager.getAlerts();
      expect(alerts.length).toBe(1);
    });

    it('should clear alerts', () => {
      manager.addRule({
        id: 'test-rule',
        name: 'Test Rule',
        description: 'Test rule',
        condition: () => true,
        severity: 'warning',
        message: 'Test alert',
        enabled: true,
      });

      const collector = new MetricsCollector();
      manager.checkAlerts(collector);
      manager.clearAlerts();

      const alerts = manager.getAlerts();
      expect(alerts.length).toBe(0);
    });
  });

  describe('Predefined Metrics', () => {
    it('should have all predefined metrics', () => {
      expect(AGENT_METRICS.TOOL_EXECUTIONS).toBeDefined();
      expect(AGENT_METRICS.TOOL_EXECUTION_DURATION).toBeDefined();
      expect(AGENT_METRICS.AGENT_SESSIONS).toBeDefined();
      expect(AGENT_METRICS.AGENT_SESSION_DURATION).toBeDefined();
      expect(AGENT_METRICS.TOKEN_USAGE).toBeDefined();
      expect(AGENT_METRICS.SECURITY_EVENTS).toBeDefined();
      expect(AGENT_METRICS.RESOURCE_USAGE).toBeDefined();
      expect(AGENT_METRICS.ERRORS).toBeDefined();
    });
  });

  describe('Default Alert Rules', () => {
    it('should have default alert rules', () => {
      expect(DEFAULT_ALERT_RULES.length).toBeGreaterThan(0);
      expect(DEFAULT_ALERT_RULES[0].id).toBeDefined();
      expect(DEFAULT_ALERT_RULES[0].name).toBeDefined();
      expect(DEFAULT_ALERT_RULES[0].condition).toBeDefined();
    });
  });

  describe('initMonitoring', () => {
    it('should initialize monitoring system', () => {
      const monitoring = initMonitoring();

      expect(monitoring.metrics).toBeDefined();
      expect(monitoring.traces).toBeDefined();
      expect(monitoring.alerts).toBeDefined();
    });
  });

  describe('generateDashboardData', () => {
    it('should generate dashboard data', () => {
      const data = generateDashboardData();

      expect(data.timestamp).toBeDefined();
      expect(data.metrics).toBeDefined();
      expect(data.metrics.toolExecutions).toBeDefined();
      expect(data.metrics.sessions).toBeDefined();
      expect(data.metrics.tokenUsage).toBeDefined();
      expect(data.metrics.securityEvents).toBeDefined();
      expect(data.metrics.resourceUsage).toBeDefined();
      expect(data.alerts).toBeDefined();
      expect(data.traces).toBeDefined();
    });
  });

  describe('healthCheck', () => {
    it('should perform health check', () => {
      const health = healthCheck();

      expect(health.status).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
      expect(health.checks).toBeDefined();
      expect(health.checks.length).toBeGreaterThan(0);
    });
  });
});
