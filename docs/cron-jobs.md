# 定时任务 (Cron Jobs)

Zhin 框架提供了基于 `cron-parser` 的定时任务功能，允许你在插件中轻松创建和管理定时任务。

## 快速开始

### 在插件中使用定时任务

```typescript
import { Plugin } from '@zhin.js/core';

export default function myPlugin(plugin: Plugin) {
  // 每分钟执行一次
  plugin.cron('0 * * * * *', () => {
    plugin.logger.info('每分钟执行的任务');
  });

  // 每天午夜执行
  plugin.cron('0 0 0 * * *', () => {
    plugin.logger.info('每日清理任务');
  });
}
```

### 手动管理定时任务

```typescript
import { Cron } from '@zhin.js/core';

// 创建定时任务
const cronJob = new Cron('0 0/15 * * * *', () => {
  console.log('每15分钟执行');
});

// 启动任务
cronJob.run();

// 停止任务
cronJob.stop();

// 销毁任务
cronJob.dispose();
```

## Cron 表达式格式

Cron 表达式使用 6 个字段：`秒 分 时 日 月 周`

### 字段说明

| 字段 | 范围 | 说明 |
|------|------|------|
| 秒 | 0-59 | 秒 |
| 分 | 0-59 | 分钟 |
| 时 | 0-23 | 小时 (24小时制) |
| 日 | 1-31 | 月中的日期 |
| 月 | 1-12 | 月份 (也可使用 JAN-DEC) |
| 周 | 0-7 | 星期 (0和7都表示周日，也可使用 SUN-SAT) |

### 特殊字符

- `*`: 匹配任意值
- `?`: 用于日和周字段，表示不指定值
- `-`: 表示范围，如 `1-5`
- `,`: 表示列表，如 `1,3,5`
- `/`: 表示步长，如 `0/15` 表示每15分钟

### 常用示例

| 表达式 | 说明 |
|--------|------|
| `0 0 0 * * *` | 每天午夜执行 |
| `0 0/15 * * * *` | 每15分钟执行 |
| `0 0 12 * * *` | 每天中午12点执行 |
| `0 0 0 1 * *` | 每月1号午夜执行 |
| `0 0 0 * * 0` | 每周日午夜执行 |
| `0 0 9 * * 1-5` | 工作日上午9点执行 |
| `0 0/30 * * * *` | 每30分钟执行 |
| `0 0 */2 * * *` | 每2小时执行 |

## API 参考

### Plugin.cron(expression, callback)

在插件中创建定时任务。

**参数:**
- `expression` (string): Cron 表达式
- `callback` (Function): 要执行的回调函数，可以是同步或异步函数

**返回值:** Plugin 实例 (支持链式调用)

```typescript
plugin
  .cron('0 0 0 * * *', () => {
    // 每日任务
  })
  .cron('0 0/15 * * * *', async () => {
    // 异步任务
    await someAsyncOperation();
  });
```

### Cron 类

#### 构造函数

```typescript
new Cron(cronExpression: string, callback: () => void | Promise<void>)
```

#### 方法

- `run()`: 启动定时任务
- `stop()`: 停止定时任务
- `dispose()`: 销毁定时任务，释放资源
- `getNextExecutionTime()`: 获取下一次执行时间

#### 属性

- `running` (boolean): 任务是否正在运行
- `disposed` (boolean): 任务是否已被销毁
- `cronExpression` (string): 原始 Cron 表达式

## 最佳实践

### 1. 错误处理

```typescript
plugin.cron('0 0 0 * * *', async () => {
  try {
    await riskyOperation();
  } catch (error) {
    plugin.logger.error('定时任务执行失败:', error);
  }
});
```

### 2. 资源清理

插件会自动管理通过 `plugin.cron()` 创建的任务，但手动创建的任务需要在插件卸载时清理：

```typescript
const cronJob = new Cron('0 * * * * *', callback);
cronJob.run();

plugin.on('dispose', () => {
  cronJob.dispose();
});
```

### 3. 避免长时间运行的任务

定时任务应该尽快完成，避免阻塞下一次执行：

```typescript
// ❌ 不好的做法
plugin.cron('0 * * * * *', () => {
  // 长时间运行的同步操作
  heavyComputation();
});

// ✅ 好的做法
plugin.cron('0 * * * * *', async () => {
  // 使用异步操作，允许其他任务执行
  await heavyComputationAsync();
});
```

### 4. 合理设置执行频率

避免设置过于频繁的定时任务，这可能会影响性能：

```typescript
// ❌ 避免每秒执行
plugin.cron('* * * * * *', callback);

// ✅ 合理的频率
plugin.cron('0 * * * * *', callback); // 每分钟
```

## 注意事项

1. **时区**: 定时任务使用系统本地时区
2. **精度**: 基于 JavaScript 的 `setTimeout`，精度受系统影响
3. **持久化**: 当前实现不包含持久化逻辑，重启后需要重新创建任务
4. **错误处理**: 任务执行中的错误会被捕获并记录，不会影响后续执行
5. **资源管理**: 插件卸载时会自动清理相关的定时任务

## 故障排除

### 任务没有执行

1. 检查 Cron 表达式是否正确
2. 确认任务已经启动 (`cronJob.run()`)
3. 检查日志中是否有错误信息

### 任务执行时间不准确

1. 确认系统时间是否正确
2. 检查是否有长时间运行的任务阻塞了执行
3. 考虑系统负载对定时器精度的影响

### 内存泄漏

1. 确保在不需要时调用 `dispose()` 方法
2. 检查回调函数中是否有未释放的资源
3. 避免在回调中创建过多的对象
