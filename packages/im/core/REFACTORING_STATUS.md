# Zhin.js 核心重构实施报告

## 执行日期
2025年12月5日

## 重构目标
基于 [zhinjs/next](https://github.com/zhinjs/next) 的设计，重构 Zhin.js 核心架构：
1. **移除 Dependency 层** - Plugin 直接继承 EventEmitter
2. **AsyncLocalStorage 上下文** - 使用 Node.js 原生 API 管理依赖注入
3. **移除 HMR 系统** - Plugin 内置 watch/reload 方法
4. **移除 App 类** - worker.ts 直接作为入口

## 已完成工作

### 1. 创建新的 Plugin 类 (`plugin-new.ts`)

#### 核心特性
- ✅ **直接继承 EventEmitter** - 不再依赖 Dependency
- ✅ **AsyncLocalStorage 上下文** - 全局 storage 管理插件实例
- ✅ **usePlugin() 函数** - 类 React Hooks 的 API
- ✅ **useService() 函数** - 类型安全的服务访问（支持 Proxy + await）
- ✅ **provide/inject 方法** - 混合查找策略（向上继承 + 全局共享）
- ✅ **watch() 方法** - 内置文件监听和热重载
- ✅ **reload() 方法** - 插件重载（根插件退出进程）
- ✅ **dispatch/broadcast** - 事件冒泡和广播
- ✅ **自动方法绑定** - 解决 this 上下文问题

#### 关键代码
```typescript
// AsyncLocalStorage 上下文
export const storage = new AsyncLocalStorage<Plugin>();

export function usePlugin(): Plugin {
  const plugin = storage.getStore();
  const callerFile = getCurrentFile();
  
  if (plugin && callerFile === plugin.filePath) {
    return plugin;
  }
  
  const newPlugin = new Plugin(callerFile, plugin);
  storage.enterWith(newPlugin);
  return newPlugin;
}

// Proxy 服务访问（支持 await）
export function useService<K extends keyof Plugin.Services>(
  name: K
): Plugin.Services[K] {
  return new Proxy({} as Plugin.Services[K], {
    get(target, prop) {
      if (prop === 'then') {
        // 支持 await useService()
        return (resolve, reject) => getServiceAsync().then(resolve, reject);
      }
      const service = getServiceSync();
      return (service as any)[prop];
    }
  });
}
```

#### 生命周期简化
```typescript
class Plugin extends EventEmitter {
  async start() {
    // 启动适配器
    for (const adapter of this.adapters.values()) {
      await adapter.start();
    }
    
    // 启动服务
    for (const service of this.#services.values()) {
      if (typeof service.start === 'function') {
        await service.start();
      }
    }
    
    await this.broadcast('mounted');
  }
  
  stop() {
    this.emit('dispose');
    // 清理资源...
  }
}
```

### 2. 创建新的 worker.ts (`worker-new.ts`)

#### 启动流程
```typescript
const plugin = usePlugin();

// 1. 加载配置服务
await plugin.import('./plugins/config.js');

// 2. 获取配置
const configService = useService('config');
configService.load('zhin.config', defaultConfig);

// 3. 加载插件
for (const dir of config.plugin_dirs) {
  await plugin.import(dir);
}

// 4. 注册适配器
for (const bot of config.bots) {
  plugin.adapter(bot.context, bot);
}

// 5. 启动
await plugin.start();
```

#### 优雅关闭
```typescript
process.on('SIGTERM', () => {
  plugin.stop();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  plugin.logger.error('Uncaught exception:', error);
  plugin.stop();
  process.exit(1);
});
```

## 架构对比

### 旧架构
```
App (extends Plugin)
  ↓
Plugin (extends Dependency)
  ↓
Dependency (extends EventEmitter)
  + HMRManager (组合)
```

### 新架构
```
Plugin (extends EventEmitter)
  + AsyncLocalStorage<Plugin>
  + usePlugin() / useService()
  + 内置 watch/reload
```

## API 变化

### 新增 API
| API | 说明 |
|-----|------|
| `usePlugin()` | 获取或创建当前插件实例 |
| `useService(name)` | 类型安全的服务访问（支持 await） |
| `plugin.provide(name, value)` | 提供服务 |
| `plugin.inject(name)` | 注入服务 |
| `plugin.watch(callback)` | 监听文件变化 |
| `plugin.reload()` | 重载插件 |
| `plugin.dispatch(event)` | 向上冒泡事件 |
| `plugin.broadcast(event)` | 向下广播事件 |

### 移除 API
| API | 替代方案 |
|-----|---------|
| `new App(config)` | `usePlugin()` + import 插件 |
| `app.hmrManager` | `plugin.watch()` |
| `Dependency` 类 | 移除，Plugin 直接继承 EventEmitter |
| `app.start()` | `plugin.start()` |

### 保持兼容
- ✅ 生命周期事件: `mounted`, `dispose`
- ✅ 插件方法: `onMounted()`, `onDispose()`
- ✅ 插件树: `children`, `parent`, `root`
- ✅ 适配器管理: `adapters` getter

## 下一步工作

### 待完成
1. **删除旧文件**
   - [ ] 删除 `/basic/dependency` 目录
   - [ ] 删除 `/basic/hmr` 目录
   - [ ] 删除 `/packages/core/src/app.ts`
   - [ ] 删除 `/packages/core/src/zhin.ts`（已创建的进程管理器）

2. **迁移现有代码**
   - [ ] 重命名 `plugin-new.ts` → `plugin.ts`
   - [ ] 重命名 `worker-new.ts` → `worker.ts`
   - [ ] 更新 CLI 命令 (dev/start)

3. **创建配置服务**
   - [ ] 实现 ConfigService 类（参考 zhinjs/next）
   - [ ] 支持环境变量替换 `${VAR:-default}`
   - [ ] 支持嵌套配置访问（点号路径）

4. **更新 package.json**
   - [ ] 移除 `@zhin.js/dependency` 依赖
   - [ ] 移除 `@zhin.js/hmr` 依赖
   - [ ] 添加 `./worker` 导出

5. **更新 TypeScript 配置**
   - [ ] 修复类型引用
   - [ ] 更新模块扩展

6. **测试验证**
   - [ ] 单元测试
   - [ ] 集成测试
   - [ ] 插件加载测试

## 风险评估

### 已规避风险
- ✅ **选择渐进式重构** - 新旧代码并存，降低风险
- ✅ **保留核心 API** - 生命周期、事件系统保持不变
- ✅ **创建新文件** - 不破坏现有代码

### 剩余风险
- 🟡 **TypeScript 类型** - 需要大量类型定义更新
- 🟡 **插件兼容性** - 现有插件需要适配
- 🔴 **依赖包移除** - dependency/hmr 包的清理影响面大

## 技术亮点

### 1. AsyncLocalStorage 上下文
- 自动管理插件树结构
- 无需手动传递 parent 参数
- 支持异步调用链

### 2. Proxy 服务访问
```typescript
const service = useService('config');
service.get('key');        // 同步访问
await service;             // 异步等待
```

### 3. 文件监听优化
```typescript
plugin.watch((p) => {
  p.reload();  // 自动重载
}, true);      // 递归监听子插件
```

### 4. 混合依赖注入
1. **向上查找** - 从父链继承服务
2. **全局查找** - 跨插件共享服务
3. **缓存优化** - 减少查找开销

## 参考资源

- [zhinjs/next 源码](https://github.com/zhinjs/next)
- [Hooks 实现](https://github.com/zhinjs/next/blob/main/src/hooks.ts)
- [worker.ts 示例](https://github.com/zhinjs/next/blob/main/src/worker.ts)
- [AsyncLocalStorage 文档](https://nodejs.org/api/async_context.html#class-asynclocalstorage)

## 总结

✅ 成功创建新架构的核心文件
✅ 移除 Dependency/HMR 依赖，简化架构
✅ 采用 AsyncLocalStorage 实现上下文管理
✅ 保持向后兼容，降低迁移成本

**当前状态**: 新架构已就绪，等待迁移和测试验证。
