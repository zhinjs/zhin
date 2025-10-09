# 🎨 Logger自定义颜色配置指南

`@zhin.js/logger` 现已支持完全自定义的颜色配置，让每个Logger都能拥有独特的视觉风格。

## 🌟 功能特性

- ✅ **级别颜色自定义**: 为每个日志级别设置专属颜色
- ✅ **名称颜色自定义**: 单色或多色循环，让不同Logger区分明显  
- ✅ **日期颜色自定义**: 个性化时间戳显示
- ✅ **继承与覆盖**: 子Logger智能继承父Logger配置
- ✅ **动态配置**: 运行时修改颜色方案
- ✅ **完全兼容**: 无配置时使用默认颜色

## 📖 基础用法

### 1. 导入所需模块

```typescript
import { getLogger, LogLevel } from '@zhin.js/logger'
import chalk from 'chalk'
```

### 2. 自定义级别颜色

```typescript
const logger = getLogger('MyApp', {
  colors: {
    levelColors: {
      [LogLevel.INFO]: chalk.magenta.bold,
      [LogLevel.WARN]: chalk.cyan,  
      [LogLevel.ERROR]: chalk.green.bold.underline
    }
  }
})

logger.info('紫色粗体INFO')
logger.warn('青色WARN')
logger.error('绿色粗体下划线ERROR')
```

### 3. 自定义名称颜色

#### 单一颜色
```typescript
const singleColorLogger = getLogger('SingleColor', {
  colors: {
    nameColor: chalk.blue.bold
  }
})
```

#### 多颜色循环
```typescript
const multiColorLogger = getLogger('MultiColor', {
  colors: {
    nameColor: [
      chalk.red.bold,
      chalk.yellow.bold,
      chalk.green.bold,
      chalk.magenta.bold
    ]
  }
})

// 每个子Logger将按顺序使用不同颜色
const child1 = multiColorLogger.getLogger('Child1') // 红色
const child2 = multiColorLogger.getLogger('Child2') // 黄色
const child3 = multiColorLogger.getLogger('Child3') // 绿色
```

### 4. 自定义日期颜色

```typescript
const logger = getLogger('CustomDate', {
  colors: {
    dateColor: chalk.yellow.bold,
    nameColor: chalk.magenta
  }
})
```

### 5. 完全自定义配置

```typescript
const fullyCustomLogger = getLogger('FullCustom', {
  colors: {
    dateColor: chalk.gray.dim,
    levelColors: {
      [LogLevel.DEBUG]: chalk.gray,
      [LogLevel.INFO]: chalk.blue.bold,
      [LogLevel.WARN]: chalk.yellow.bold,
      [LogLevel.ERROR]: chalk.red.bold.underline
    },
    nameColor: [
      chalk.cyan.bold,
      chalk.magenta.bold,
      chalk.green.bold
    ]
  }
})
```

## 🔄 继承与覆盖

### 父子Logger颜色继承

```typescript
// 父Logger配置
const parent = getLogger('Parent', {
  colors: {
    dateColor: chalk.blue,
    levelColors: {
      [LogLevel.INFO]: chalk.green.bold
    },
    nameColor: chalk.magenta.bold
  }
})

// 子Logger继承所有颜色配置
const child1 = parent.getLogger('Child1')
child1.info('完全继承父Logger的颜色')

// 子Logger部分覆盖
const child2 = parent.getLogger('Child2', {
  colors: {
    levelColors: {
      [LogLevel.INFO]: chalk.red.bold  // 只覆盖INFO颜色
    }
    // dateColor和nameColor继承自父Logger
  }
})
child2.info('INFO是红色，其他颜色继承自父Logger')
```

### 动态修改颜色

```typescript
const dynamicLogger = getLogger('Dynamic')
dynamicLogger.info('初始默认颜色')

// 运行时修改颜色配置
dynamicLogger.setOptions({
  colors: {
    levelColors: {
      [LogLevel.INFO]: chalk.magenta.bold.underline
    },
    nameColor: chalk.green.bold
  }
})
dynamicLogger.info('动态修改后的颜色')
```

## 🎯 实际应用场景

### 系统模块区分

```typescript
// 数据库Logger - 蓝色主题
const dbLogger = getLogger('Database', {
  colors: {
    levelColors: { [LogLevel.INFO]: chalk.blue.bold },
    nameColor: chalk.blue
  }
})

// API Logger - 绿色主题  
const apiLogger = getLogger('API', {
  colors: {
    levelColors: { [LogLevel.INFO]: chalk.green.bold },
    nameColor: chalk.green
  }
})

// 安全Logger - 红色警告主题
const securityLogger = getLogger('Security', {
  colors: {
    levelColors: { 
      [LogLevel.ERROR]: chalk.red.bold.underline.bgYellow 
    },
    nameColor: chalk.red.bold
  }
})
```

### 开发团队协作

```typescript
// 为不同开发者分配专属颜色
const teamColors = {
  alice: { nameColor: chalk.magenta.bold },
  bob: { nameColor: chalk.cyan.bold },
  charlie: { nameColor: chalk.green.bold }
}

const aliceLogger = getLogger('Alice', { colors: teamColors.alice })
const bobLogger = getLogger('Bob', { colors: teamColors.bob })
const charlieLogger = getLogger('Charlie', { colors: teamColors.charlie })
```

### 环境差异化

```typescript
// 开发环境 - 丰富色彩
const devLogger = getLogger('Development', {
  colors: {
    nameColor: [
      chalk.red.bold, chalk.green.bold, chalk.blue.bold,
      chalk.magenta.bold, chalk.cyan.bold, chalk.yellow.bold
    ]
  }
})

// 生产环境 - 简约主题
const prodLogger = getLogger('Production', {
  colors: {
    dateColor: chalk.gray,
    levelColors: {
      [LogLevel.INFO]: chalk.white,
      [LogLevel.WARN]: chalk.yellow,
      [LogLevel.ERROR]: chalk.red.bold
    },
    nameColor: chalk.white.dim
  }
})
```

## 🎨 颜色配置最佳实践

### 1. 功能模块分类
- **系统组件**: 冷色调（蓝、灰、紫）
- **业务逻辑**: 中性色调（绿、青）
- **安全警告**: 暖色调（红、黄、橙）

### 2. 环境适配
- **开发环境**: 丰富色彩，便于调试区分
- **测试环境**: 中等饱和度，突出重点信息
- **生产环境**: 简约配色，减少视觉干扰

### 3. 团队协作
- 为每个开发者分配专属颜色
- 使用颜色区分不同服务模块
- 保持颜色含义的一致性

### 4. 可访问性考虑
- 避免仅依赖颜色传达信息
- 选择对比度足够的颜色组合
- 考虑色盲用户的使用体验

## 🔗 TypeScript类型支持

```typescript
import { LoggerColorOptions, ColorFunction } from '@zhin.js/logger'

// 完整的类型定义
interface LoggerColorOptions {
  levelColors?: Partial<Record<LogLevel, ColorFunction>>
  nameColor?: ColorFunction | ColorFunction[]
  dateColor?: ColorFunction
}

// ColorFunction类型
type ColorFunction = (text: string) => string
```

## 📊 性能说明

- ✅ **零性能开销**: 颜色配置不影响日志性能
- ✅ **智能缓存**: 名称颜色映射自动缓存，避免重复计算
- ✅ **内存优化**: 颜色缓存有上限保护，防止内存泄漏

## 🎉 总结

自定义颜色配置让Logger不仅仅是日志工具，更成为了代码可视化的得力助手。通过合理的颜色规划，可以显著提升开发效率和代码可读性！

---

*更多功能和示例请查看主 README 文档*
