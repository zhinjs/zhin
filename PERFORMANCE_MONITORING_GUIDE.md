# Zhin.js 性能监控使用指南

## 🎯 核心原则

> **监控不干预** - 观察者而非控制者  
> **记录不手动** - 让 V8 做它的工作  
> **洞察不解决** - 帮助发现问题，而非修复问题

---

## 📦 功能特性

### 已增强的 PerformanceMonitor

位置: `basic/hmr/src/performance.ts`

#### 新增功能

1. **内存监控**
   - ✅ RSS、Heap、External、ArrayBuffers 全面监控
   - ✅ 记录内存峰值和时间戳
   - ✅ 自动计算堆使用百分比

2. **GC 事件监控**
   - ✅ 可选的 GC 事件跟踪
   - ✅ 统计 GC 次数、总时间、平均时间
   - ✅ 可配置仅在开发环境启用

3. **定期检查**
   - ✅ 可配置的检查间隔（默认 1 分钟）
   - ✅ 高内存阈值回调（默认 90%）
   - ✅ 不影响主流程性能

4. **详细报告**
   - ✅ 性能报告（加载时间、重载统计）
   - ✅ 内存报告（当前使用、峰值、百分比）
   - ✅ 格式化输出（人类可读）

---

## 🚀 使用方法

### 1. 基础使用

```typescript
import { PerformanceMonitor } from '@zhin.js/hmr';

// 创建监控器
const monitor = new PerformanceMonitor({
  checkInterval: 60000,          // 每分钟检查一次
  highMemoryThreshold: 90,       // 90% 阈值
  monitorGC: true,               // 启用 GC 监控
  gcOnlyInDev: true              // 只在开发环境监控 GC
});

// 启动监控
monitor.startMonitoring((stats) => {
  // 高内存警告回调
  console.warn('⚠️  High memory usage detected!');
  console.warn(`Heap: ${(stats.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  
  // ❌ 不要这样做！
  // if (global.gc) global.gc();
  
  // ✅ 只记录，让 V8 决定
});
```

### 2. 集成到 App 类

```typescript
// packages/core/src/app.ts
import { PerformanceMonitor } from '@zhin.js/hmr';

export class App extends HMR<Plugin> {
  private performanceMonitor: PerformanceMonitor;
  
  constructor(config: AppConfig) {
    super(...);
    
    // 创建性能监控器
    this.performanceMonitor = new PerformanceMonitor({
      checkInterval: this.config.get('performance_check_interval') || 60000,
      highMemoryThreshold: this.config.get('memory_threshold') || 90,
      monitorGC: process.env.NODE_ENV === 'development',
      gcOnlyInDev: true
    });
    
    // 启动监控
    this.performanceMonitor.startMonitoring((stats) => {
      const heapPercent = (stats.memoryUsage.heapUsed / stats.memoryUsage.heapTotal) * 100;
      
      this.logger.warn(`High memory usage: ${heapPercent.toFixed(2)}%`);
      this.logger.warn(`RSS: ${(stats.memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`);
      
      // 发送事件，让插件可以响应
      this.broadcast('memory.high', stats);
    });
  }
  
  async stop() {
    // 停止监控并打印最终报告
    this.logger.info(this.performanceMonitor.getFullReport());
    this.performanceMonitor.stopMonitoring();
    
    // ... 其他清理
  }
  
  // 添加 API 方法
  getPerformanceStats() {
    return this.performanceMonitor.stats;
  }
  
  getPerformanceReport() {
    return this.performanceMonitor.getFullReport();
  }
}
```

### 3. 添加配置选项

```typescript
// packages/core/src/app.ts - Schema 定义

export class App extends HMR<Plugin> {
  static schema = Schema.object({
    // ... 其他配置
    
    /** 性能监控配置 */
    performance: Schema.object({
      /** 是否启用性能监控 */
      enabled: Schema.boolean().default(true).description('启用性能监控'),
      
      /** 检查间隔（毫秒） */
      check_interval: Schema.number().default(60000).description('检查间隔（毫秒）'),
      
      /** 高内存阈值（百分比） */
      memory_threshold: Schema.number().default(90).min(50).max(99).description('高内存阈值（%）'),
      
      /** 是否监控 GC */
      monitor_gc: Schema.boolean().default(false).description('监控 GC 事件（开发环境推荐）'),
    }).description('性能监控配置')
  });
}
```

### 4. 配置文件示例

```yaml
# zhin.config.yml

# 性能监控配置
performance:
  enabled: true
  check_interval: 60000  # 每分钟检查
  memory_threshold: 90   # 90% 阈值
  monitor_gc: false      # 生产环境不监控 GC
```

---

## 📊 监控输出示例

### 完整报告

```
Performance Report:
  Uptime: 2h 15m 30s
  Total Load Time: 1250ms
  Total Reload Time: 3420ms
  Reload Count: 15
  Average Reload Time: 228.00ms
  Errors: 2
  Last Reload: 185ms

Memory Report:
  RSS: 142.50 MB (Peak: 158.32 MB)
  Heap: 85.23 MB / 120.00 MB (71.03%)
  External: 12.45 MB
  ArrayBuffers: 8.20 MB
  GC Count: 42
  GC Total Time: 1250.45ms
  GC Avg Time: 29.77ms
  GC Last: 32.15ms
```

### 高内存警告

```
⚠️  High memory usage detected!
Heap: 108.50 MB / 120.00 MB (90.42%)
RSS: 155.23 MB
Peak RSS: 158.32 MB (at 14:35:22)

💡 建议:
  • 检查是否有未清理的缓存
  • 查看是否有内存泄漏
  • 使用 Chrome DevTools 生成堆快照分析
  
❌ 不要手动调用 gc()
✅ V8 会在需要时自动处理
```

---

## 🔧 与其他工具集成

### 1. 与 test-plugin 集成

```typescript
// examples/test-bot/src/plugins/test-plugin.ts

import { useApp } from '@zhin.js/core';

// 添加性能报告命令
addCommand(
  new MessageCommand('perf').action(() => {
    const app = useApp();
    return app.getPerformanceReport();
  })
);

// 监听高内存事件
onEvent('memory.high', (stats) => {
  console.warn('High memory detected in test plugin!');
  console.warn('Consider checking for memory leaks...');
});
```

### 2. 与日志系统集成

```typescript
// 定期记录性能数据
setInterval(() => {
  const stats = monitor.stats;
  
  logger.debug('Performance Stats', {
    uptime: monitor.getUptime(),
    memory: stats.memoryUsage,
    reloadCount: stats.reloadCount,
    errors: stats.errors
  });
}, 300000); // 每 5 分钟记录一次
```

### 3. 与 MCP 集成（可选）

```typescript
// 通过 MCP 暴露性能 API
export const performanceTools = {
  getStats: () => monitor.stats,
  getReport: () => monitor.getFullReport(),
  getMemoryReport: () => monitor.getMemoryReport()
};
```

---

## ⚠️ 最佳实践

### ✅ 应该做的

1. **定期检查，不频繁**
   ```typescript
   checkInterval: 60000  // 每分钟一次就够了
   ```

2. **记录日志，不手动 GC**
   ```typescript
   monitor.startMonitoring((stats) => {
     logger.warn('High memory', stats);
     // ✅ 只记录
     // ❌ 不要: global.gc()
   });
   ```

3. **开发环境才监控 GC**
   ```typescript
   monitorGC: process.env.NODE_ENV === 'development'
   ```

4. **停止时清理**
   ```typescript
   async stop() {
     monitor.stopMonitoring();  // 清理定时器和观察者
   }
   ```

### ❌ 不应该做的

1. **频繁检查**
   ```typescript
   checkInterval: 1000  // ❌ 太频繁！
   ```

2. **在回调中手动 GC**
   ```typescript
   monitor.startMonitoring((stats) => {
     if (global.gc) global.gc();  // ❌ 不要！
   });
   ```

3. **生产环境监控 GC**
   ```typescript
   monitorGC: true,        // ❌ 有性能开销
   gcOnlyInDev: false      // ❌ 不建议
   ```

4. **忘记停止监控**
   ```typescript
   // ❌ 忘记调用 stopMonitoring()
   // 会导致定时器泄漏
   ```

---

## 📈 性能影响分析

### 监控开销

| 配置 | CPU 开销 | 内存开销 | 建议 |
|------|----------|----------|------|
| 基础监控 (每分钟) | < 0.1% | < 1 MB | ✅ 推荐 |
| + GC 监控 (开发) | < 0.5% | < 2 MB | ✅ 开发环境 |
| + GC 监控 (生产) | < 0.5% | < 2 MB | ⚠️  按需启用 |
| 频繁检查 (每秒) | 1-2% | < 1 MB | ❌ 不推荐 |

---

## 🎓 理解监控数据

### 内存指标含义

- **RSS (Resident Set Size)**: 进程实际占用的物理内存
  - 包括堆、栈、共享库等
  - 是操作系统看到的内存占用

- **Heap Total**: V8 分配的总堆内存
  - JavaScript 对象存储的空间

- **Heap Used**: 实际使用的堆内存
  - Heap Used / Heap Total = 使用率

- **External**: V8 管理的 C++ 对象内存
  - Buffer、TypedArray 等

- **ArrayBuffers**: 二进制数据缓冲区
  - 通常用于网络、文件等 I/O

### GC 指标含义

- **GC Count**: GC 触发次数
  - 正常：每小时几十次
  - 异常：每分钟数十次（可能有问题）

- **GC Duration**: GC 执行时间
  - Minor GC: 通常 < 10ms
  - Major GC: 可能 50-200ms
  - 过长会导致卡顿

### 何时需要关注

🚨 **需要关注的信号：**
- Heap 使用率持续 > 90%
- RSS 持续增长不回落
- GC 频率异常高（每分钟 > 10 次）
- GC 单次时间过长（> 500ms）

✅ **正常的信号：**
- 内存使用有起伏（锯齿状）
- GC 后内存回落
- Heap 使用率在 50-80% 波动

---

## 🔍 故障排查

### 问题：内存持续增长

```typescript
// 1. 记录详细的内存报告
console.log(monitor.getMemoryReport());

// 2. 生成堆快照（使用 test-plugin 的 heap 命令）
// 发送: heap

// 3. 分析堆快照
node analyze-heap.js heap-xxx.heapsnapshot

// 4. 查找未清理的引用
// - 检查 Map/Set 是否有限制大小
// - 检查事件监听器是否正确移除
// - 检查定时器是否清理
```

### 问题：GC 频率过高

```typescript
// 可能原因：
// 1. 创建大量临时对象
// 2. 频繁的字符串拼接
// 3. 未使用对象池

// 解决方案：
// 1. 重用对象而非创建新对象
// 2. 使用 StringBuilder 或模板字符串
// 3. 实现对象池模式
```

---

## 💡 总结

### 监控的目的

1. **发现问题** - 而非解决问题
2. **提供洞察** - 帮助理解内存使用模式
3. **辅助决策** - 是否需要优化

### 核心理念

```
监控 → 记录 → 分析 → 优化代码
  ↓
不是
  ↓
监控 → 手动 GC → 掩盖问题
```

**记住：**
- ✅ 监控是手段，不是目的
- ✅ 记录是观察，不是干预
- ✅ V8 的 GC 比我们聪明
- ✅ 好的代码不需要频繁 GC

---

生成时间: 2025-11-24  
版本: Zhin.js v1.0.0+monitoring

