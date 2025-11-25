# 性能监控快速上手

## 🚀 一分钟集成

### 1. 导入并创建

```typescript
import { PerformanceMonitor } from '@zhin.js/hmr';

const monitor = new PerformanceMonitor({
  checkInterval: 60000,        // 每分钟
  highMemoryThreshold: 90,     // 90%
  monitorGC: true,             // 开发环境推荐
});
```

### 2. 启动监控

```typescript
monitor.startMonitoring((stats) => {
  console.warn('⚠️  High memory!');
  console.warn(`Heap: ${(stats.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  // ❌ 不要: global.gc()
  // ✅ 只记录日志
});
```

### 3. 查看报告

```typescript
// 完整报告
console.log(monitor.getFullReport());

// 只看内存
console.log(monitor.getMemoryReport());

// 获取原始数据
const stats = monitor.stats;
```

### 4. 清理资源

```typescript
// 停止时记得清理
monitor.stopMonitoring();
```

---

## 📊 输出示例

```
Memory Report:
  RSS: 142.50 MB (Peak: 158.32 MB)
  Heap: 85.23 MB / 120.00 MB (71.03%)
  External: 12.45 MB
  ArrayBuffers: 8.20 MB
  GC Count: 42
  GC Avg Time: 29.77ms
```

---

## ⚡ 记住四大原则

1. **不手动 GC** - V8 已经足够智能
2. **及时清理引用** - 让 GC 更容易工作
3. **使用 Tree Shaking** - 生产环境更轻量
4. **监控不干预** - 记录日志，让 V8 决定

---

## 📚 详细文档

- [完整指南](./PERFORMANCE_MONITORING_GUIDE.md)
- [内存管理最佳实践](./MEMORY_MANAGEMENT_BEST_PRACTICES.md)
- [优化总结](./MEMORY_OPTIMIZATION_SUMMARY.md)

---

生成时间: 2025-11-24

