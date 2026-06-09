/**
 * 异常检测模块
 *
 * 提供：
 * - 行为模式分析
 * - 异常检测算法
 * - 实时告警
 * - 自适应阈值
 */

// ── 行为模式定义 ──────────────────────────────────────────────────────

export interface BehaviorPattern {
  /** 模式 ID */
  id: string;
  /** 模式名称 */
  name: string;
  /** 模式描述 */
  description: string;
  /** 模式特征 */
  features: Record<string, number>;
  /** 正常范围 */
  normalRange: {
    min: number;
    max: number;
  };
  /** 权重 */
  weight: number;
}

// ── 异常事件定义 ──────────────────────────────────────────────────────

export interface AnomalyEvent {
  /** 事件 ID */
  id: string;
  /** 时间戳 */
  timestamp: number;
  /** 异常类型 */
  type: 'behavior' | 'threshold' | 'pattern' | 'security';
  /** 严重程度 */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** 描述 */
  description: string;
  /** 相关数据 */
  data: Record<string, unknown>;
  /** 置信度（0-1） */
  confidence: number;
  /** 建议的响应 */
  suggestedAction?: string;
}

// ── 检测规则定义 ──────────────────────────────────────────────────────

export interface DetectionRule {
  /** 规则 ID */
  id: string;
  /** 规则名称 */
  name: string;
  /** 规则描述 */
  description: string;
  /** 检测函数 */
  detect: (data: Record<string, unknown>) => AnomalyEvent | null;
  /** 是否启用 */
  enabled: boolean;
  /** 优先级 */
  priority: number;
}

// ── 异常检测器类 ──────────────────────────────────────────────────────

export class AnomalyDetector {
  private patterns: Map<string, BehaviorPattern> = new Map();
  private rules: Map<string, DetectionRule> = new Map();
  private events: AnomalyEvent[] = [];
  private listeners: Array<(event: AnomalyEvent) => void> = [];
  private static readonly MAX_EVENTS = 500;

  /**
   * 添加行为模式
   */
  addPattern(pattern: BehaviorPattern): void {
    this.patterns.set(pattern.id, pattern);
  }

  /**
   * 移除行为模式
   */
  removePattern(id: string): void {
    this.patterns.delete(id);
  }

  /**
   * 添加检测规则
   */
  addRule(rule: DetectionRule): void {
    this.rules.set(rule.id, rule);
  }

  /**
   * 移除检测规则
   */
  removeRule(id: string): void {
    this.rules.delete(id);
  }

  /**
   * 检测异常
   */
  detect(data: Record<string, unknown>): AnomalyEvent[] {
    const anomalies: AnomalyEvent[] = [];

    // 运行所有检测规则
    for (const [ruleId, rule] of this.rules.entries()) {
      if (!rule.enabled) {
        continue;
      }

      try {
        const event = rule.detect(data);
        if (event) {
          anomalies.push(event);
          this.pushEvent(event);
        }
      } catch (error) {
        console.error(`[AnomalyDetector] Rule ${ruleId} failed:`, error);
      }
    }

    // 检查行为模式
    for (const [patternId, pattern] of this.patterns.entries()) {
      const anomaly = this.checkPattern(pattern, data);
      if (anomaly) {
        anomalies.push(anomaly);
        this.pushEvent(anomaly);
      }
    }

    return anomalies;
  }

  private pushEvent(event: AnomalyEvent): void {
    this.events.push(event);
    if (this.events.length > AnomalyDetector.MAX_EVENTS) {
      this.events.splice(0, this.events.length - AnomalyDetector.MAX_EVENTS);
    }
    this.notifyListeners(event);
  }

  /**
   * 获取所有异常事件
   */
  getEvents(): AnomalyEvent[] {
    return [...this.events];
  }

  /**
   * 获取最近的异常事件
   */
  getRecentEvents(count: number = 10): AnomalyEvent[] {
    return this.events.slice(-count);
  }

  /**
   * 清除事件历史
   */
  clearEvents(): void {
    this.events = [];
  }

  /**
   * 添加事件监听器
   */
  onAnomaly(listener: (event: AnomalyEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * 检查行为模式
   */
  private checkPattern(
    pattern: BehaviorPattern,
    data: Record<string, unknown>,
  ): AnomalyEvent | null {
    const value = data[pattern.id];
    if (typeof value !== 'number') {
      return null;
    }

    const { min, max } = pattern.normalRange;
    if (value >= min && value <= max) {
      return null;
    }

    // 计算偏离程度
    const deviation = value < min
      ? (min - value) / (max - min)
      : (value - max) / (max - min);

    // 根据偏离程度确定严重程度
    let severity: 'low' | 'medium' | 'high' | 'critical';
    if (deviation < 0.2) {
      severity = 'low';
    } else if (deviation < 0.5) {
      severity = 'medium';
    } else if (deviation < 1.0) {
      severity = 'high';
    } else {
      severity = 'critical';
    }

    return {
      id: `anomaly-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      type: 'behavior',
      severity,
      description: `行为异常: ${pattern.name} 值 ${value} 超出正常范围 [${min}, ${max}]`,
      data: {
        patternId: pattern.id,
        value,
        normalRange: pattern.normalRange,
        deviation,
      },
      confidence: Math.min(1, deviation),
      suggestedAction: `检查 ${pattern.name} 相关的系统状态`,
    };
  }

  /**
   * 通知监听器
   */
  private notifyListeners(event: AnomalyEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[AnomalyDetector] Listener error:', error);
      }
    }
  }
}

// ── 预定义行为模式 ────────────────────────────────────────────────────

export const DEFAULT_BEHAVIOR_PATTERNS: BehaviorPattern[] = [
  {
    id: 'tool_execution_rate',
    name: '工具执行速率',
    description: '每分钟工具执行次数',
    features: { window: 60000 },
    normalRange: { min: 0, max: 100 },
    weight: 1.0,
  },
  {
    id: 'error_rate',
    name: '错误率',
    description: '错误请求占比',
    features: { window: 300000 },
    normalRange: { min: 0, max: 0.1 },
    weight: 2.0,
  },
  {
    id: 'token_usage_rate',
    name: 'Token 使用速率',
    description: '每分钟 Token 使用量',
    features: { window: 60000 },
    normalRange: { min: 0, max: 10000 },
    weight: 1.5,
  },
  {
    id: 'security_event_rate',
    name: '安全事件速率',
    description: '每分钟安全事件数',
    features: { window: 60000 },
    normalRange: { min: 0, max: 5 },
    weight: 3.0,
  },
];

// ── 预定义检测规则 ────────────────────────────────────────────────────

export const DEFAULT_DETECTION_RULES: DetectionRule[] = [
  {
    id: 'high_error_rate',
    name: '高错误率检测',
    description: '检测错误率是否超过阈值',
    detect: (data) => {
      const errorRate = data.errorRate as number;
      if (errorRate && errorRate > 0.5) {
        return {
          id: `rule-${Date.now()}`,
          timestamp: Date.now(),
          type: 'threshold',
          severity: 'high',
          description: `错误率过高: ${(errorRate * 100).toFixed(1)}%`,
          data: { errorRate, threshold: 0.5 },
          confidence: 0.9,
          suggestedAction: '检查系统日志，找出错误原因',
        };
      }
      return null;
    },
    enabled: true,
    priority: 1,
  },
  {
    id: 'suspicious_tool_usage',
    name: '可疑工具使用检测',
    description: '检测可疑的工具使用模式',
    detect: (data) => {
      const toolName = data.toolName as string;
      const suspiciousTools = ['eval', 'exec', 'spawn', 'fork'];

      if (toolName && suspiciousTools.includes(toolName)) {
        return {
          id: `rule-${Date.now()}`,
          timestamp: Date.now(),
          type: 'security',
          severity: 'critical',
          description: `检测到可疑工具使用: ${toolName}`,
          data: { toolName, suspiciousTools },
          confidence: 0.95,
          suggestedAction: '立即审查该工具调用的合法性',
        };
      }
      return null;
    },
    enabled: true,
    priority: 0,
  },
  {
    id: 'rapid_requests',
    name: '快速请求检测',
    description: '检测请求频率是否异常',
    detect: (data) => {
      const requestRate = data.requestRate as number;
      if (requestRate && requestRate > 1000) {
        return {
          id: `rule-${Date.now()}`,
          timestamp: Date.now(),
          type: 'behavior',
          severity: 'medium',
          description: `请求频率异常: ${requestRate} 请求/分钟`,
          data: { requestRate, threshold: 1000 },
          confidence: 0.8,
          suggestedAction: '检查是否有 DDoS 攻击或滥用行为',
        };
      }
      return null;
    },
    enabled: true,
    priority: 2,
  },
];

// ── 全局实例 ──────────────────────────────────────────────────────────

let globalAnomalyDetector: AnomalyDetector | null = null;

/**
 * 获取全局异常检测器
 */
export function getAnomalyDetector(): AnomalyDetector {
  if (!globalAnomalyDetector) {
    globalAnomalyDetector = new AnomalyDetector();

    // 添加预定义行为模式
    for (const pattern of DEFAULT_BEHAVIOR_PATTERNS) {
      globalAnomalyDetector.addPattern(pattern);
    }

    // 添加预定义检测规则
    for (const rule of DEFAULT_DETECTION_RULES) {
      globalAnomalyDetector.addRule(rule);
    }
  }
  return globalAnomalyDetector;
}

/**
 * 初始化异常检测器
 */
export function initAnomalyDetector(): AnomalyDetector {
  globalAnomalyDetector = new AnomalyDetector();

  // 添加预定义行为模式
  for (const pattern of DEFAULT_BEHAVIOR_PATTERNS) {
    globalAnomalyDetector.addPattern(pattern);
  }

  // 添加预定义检测规则
  for (const rule of DEFAULT_DETECTION_RULES) {
    globalAnomalyDetector.addRule(rule);
  }

  return globalAnomalyDetector;
}

/** 重置全局异常检测器（用于测试隔离） */
export function resetAnomalyDetector(): void {
  globalAnomalyDetector = null;
}
