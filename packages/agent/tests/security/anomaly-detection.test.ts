import { describe, it, expect, beforeEach } from 'vitest';
import {
  AnomalyDetector,
  initAnomalyDetector,
  getAnomalyDetector,
  DEFAULT_BEHAVIOR_PATTERNS,
  DEFAULT_DETECTION_RULES,
} from '../../src/security/anomaly-detection.js';

describe('AnomalyDetector', () => {
  let detector: AnomalyDetector;

  beforeEach(() => {
    detector = new AnomalyDetector();
  });

  describe('基本功能', () => {
    it('应该创建检测器', () => {
      expect(detector).toBeDefined();
    });

    it('应该添加行为模式', () => {
      detector.addPattern({
        id: 'test_pattern',
        name: 'Test Pattern',
        description: 'Test pattern',
        features: {},
        normalRange: { min: 0, max: 100 },
        weight: 1.0,
      });

      // 验证模式已添加（通过检测来验证）
      const anomalies = detector.detect({ test_pattern: 150 });
      expect(anomalies.length).toBe(1);
    });

    it('应该移除行为模式', () => {
      detector.addPattern({
        id: 'test_pattern',
        name: 'Test Pattern',
        description: 'Test pattern',
        features: {},
        normalRange: { min: 0, max: 100 },
        weight: 1.0,
      });

      detector.removePattern('test_pattern');

      // 验证模式已移除
      const anomalies = detector.detect({ test_pattern: 150 });
      expect(anomalies.length).toBe(0);
    });

    it('应该添加检测规则', () => {
      detector.addRule({
        id: 'test_rule',
        name: 'Test Rule',
        description: 'Test rule',
        detect: (data) => {
          if (data.value > 100) {
            return {
              id: 'test_anomaly',
              timestamp: Date.now(),
              type: 'threshold',
              severity: 'high',
              description: 'Value too high',
              data: { value: data.value },
              confidence: 0.9,
            };
          }
          return null;
        },
        enabled: true,
        priority: 1,
      });

      const anomalies = detector.detect({ value: 150 });
      expect(anomalies.length).toBe(1);
      expect(anomalies[0].description).toBe('Value too high');
    });

    it('应该移除检测规则', () => {
      detector.addRule({
        id: 'test_rule',
        name: 'Test Rule',
        description: 'Test rule',
        detect: () => ({
          id: 'test_anomaly',
          timestamp: Date.now(),
          type: 'threshold',
          severity: 'high',
          description: 'Test anomaly',
          data: {},
          confidence: 0.9,
        }),
        enabled: true,
        priority: 1,
      });

      detector.removeRule('test_rule');

      const anomalies = detector.detect({});
      expect(anomalies.length).toBe(0);
    });
  });

  describe('异常检测', () => {
    it('应该检测行为异常', () => {
      detector.addPattern({
        id: 'cpu_usage',
        name: 'CPU Usage',
        description: 'CPU usage',
        features: {},
        normalRange: { min: 0, max: 80 },
        weight: 1.0,
      });

      // 正常值
      let anomalies = detector.detect({ cpu_usage: 50 });
      expect(anomalies.length).toBe(0);

      // 异常值
      anomalies = detector.detect({ cpu_usage: 95 });
      expect(anomalies.length).toBe(1);
      expect(anomalies[0].type).toBe('behavior');
      // 严重程度取决于偏离程度
      expect(['low', 'medium', 'high', 'critical']).toContain(anomalies[0].severity);
    });

    it('应该检测阈值异常', () => {
      detector.addRule({
        id: 'high_value',
        name: 'High Value',
        description: 'High value detection',
        detect: (data) => {
          if (data.value > 100) {
            return {
              id: 'high_value_anomaly',
              timestamp: Date.now(),
              type: 'threshold',
              severity: 'medium',
              description: 'Value exceeds threshold',
              data: { value: data.value, threshold: 100 },
              confidence: 0.8,
            };
          }
          return null;
        },
        enabled: true,
        priority: 1,
      });

      const anomalies = detector.detect({ value: 150 });
      expect(anomalies.length).toBe(1);
      expect(anomalies[0].description).toBe('Value exceeds threshold');
    });

    it('应该检测安全异常', () => {
      detector.addRule({
        id: 'suspicious_command',
        name: 'Suspicious Command',
        description: 'Suspicious command detection',
        detect: (data) => {
          const suspiciousCommands = ['rm -rf', 'sudo', 'eval'];
          if (data.command && suspiciousCommands.some(cmd => String(data.command).includes(cmd))) {
            return {
              id: 'security_anomaly',
              timestamp: Date.now(),
              type: 'security',
              severity: 'critical',
              description: 'Suspicious command detected',
              data: { command: data.command },
              confidence: 0.95,
            };
          }
          return null;
        },
        enabled: true,
        priority: 0,
      });

      const anomalies = detector.detect({ command: 'sudo rm -rf /' });
      expect(anomalies.length).toBe(1);
      expect(anomalies[0].type).toBe('security');
      expect(anomalies[0].severity).toBe('critical');
    });

    it('应该获取异常事件', () => {
      detector.addPattern({
        id: 'test_pattern',
        name: 'Test Pattern',
        description: 'Test pattern',
        features: {},
        normalRange: { min: 0, max: 100 },
        weight: 1.0,
      });

      detector.detect({ test_pattern: 150 });
      detector.detect({ test_pattern: 200 });

      const events = detector.getEvents();
      expect(events.length).toBe(2);
    });

    it('应该获取最近的异常事件', () => {
      detector.addPattern({
        id: 'test_pattern',
        name: 'Test Pattern',
        description: 'Test pattern',
        features: {},
        normalRange: { min: 0, max: 100 },
        weight: 1.0,
      });

      for (let i = 0; i < 20; i++) {
        detector.detect({ test_pattern: 150 + i });
      }

      const recentEvents = detector.getRecentEvents(5);
      expect(recentEvents.length).toBe(5);
    });

    it('应该清除事件历史', () => {
      detector.addPattern({
        id: 'test_pattern',
        name: 'Test Pattern',
        description: 'Test pattern',
        features: {},
        normalRange: { min: 0, max: 100 },
        weight: 1.0,
      });

      detector.detect({ test_pattern: 150 });
      detector.clearEvents();

      const events = detector.getEvents();
      expect(events.length).toBe(0);
    });
  });

  describe('事件监听', () => {
    it('应该触发异常事件', () => {
      let triggered = false;
      let triggeredEvent: any = null;

      detector.addPattern({
        id: 'test_pattern',
        name: 'Test Pattern',
        description: 'Test pattern',
        features: {},
        normalRange: { min: 0, max: 100 },
        weight: 1.0,
      });

      detector.onAnomaly((event) => {
        triggered = true;
        triggeredEvent = event;
      });

      detector.detect({ test_pattern: 150 });

      expect(triggered).toBe(true);
      expect(triggeredEvent).toBeDefined();
      expect(triggeredEvent.type).toBe('behavior');
    });

    it('应该取消事件监听', () => {
      let triggerCount = 0;

      detector.addPattern({
        id: 'test_pattern',
        name: 'Test Pattern',
        description: 'Test pattern',
        features: {},
        normalRange: { min: 0, max: 100 },
        weight: 1.0,
      });

      const unsubscribe = detector.onAnomaly(() => {
        triggerCount++;
      });

      detector.detect({ test_pattern: 150 });
      expect(triggerCount).toBe(1);

      unsubscribe();
      detector.detect({ test_pattern: 200 });
      expect(triggerCount).toBe(1); // 不应该再次触发
    });
  });

  describe('预定义模式和规则', () => {
    it('应该有预定义行为模式', () => {
      expect(DEFAULT_BEHAVIOR_PATTERNS.length).toBeGreaterThan(0);
      expect(DEFAULT_BEHAVIOR_PATTERNS[0].id).toBeDefined();
      expect(DEFAULT_BEHAVIOR_PATTERNS[0].name).toBeDefined();
    });

    it('应该有预定义检测规则', () => {
      expect(DEFAULT_DETECTION_RULES.length).toBeGreaterThan(0);
      expect(DEFAULT_DETECTION_RULES[0].id).toBeDefined();
      expect(DEFAULT_DETECTION_RULES[0].name).toBeDefined();
    });
  });

  describe('全局实例', () => {
    it('应该获取全局实例', () => {
      const instance = getAnomalyDetector();
      expect(instance).toBeDefined();
    });

    it('应该初始化全局实例', () => {
      const instance = initAnomalyDetector();
      expect(instance).toBeDefined();
    });

    it('应该使用预定义模式和规则', () => {
      const detector = initAnomalyDetector();

      // 测试预定义规则
      const anomalies = detector.detect({
        toolName: 'eval',
      });

      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies[0].type).toBe('security');
    });
  });
});
