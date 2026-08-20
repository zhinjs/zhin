// @ts-nocheck — 说明性骨架：assets/ 不属于任何 package/tsconfig，下面的 import 在此目录无法解析。
// 请复制到真实插件包中使用。
//
// 模块化插件入口：plugin.ts 只负责「装配 + 生命周期」。
// 命令/中间件/组件/工具都由能力目录自动发现，**不需要**再 `import './commands/index.js'`。
//
//   my-plugin/
//     package.json      ← "zhin": { entry, engine, runtime, features, plugins }
//     schema.json       ← 只声明本 package 自己的配置字段
//     plugin.ts         ← 本文件
//     commands/         middlewares/        components/
//     tools/            agent/skills/       agent/schedules/
import { createToken, definePlugin } from 'zhin.js';

/** 供本包能力读取的 owner Resource（取代旧的模块级共享闭包/全局 registry）。 */
export interface MyPluginService {
  readonly enabled: boolean;
  close(): void;
}

export const myPluginServiceToken = createToken<MyPluginService>('my-plugin.service');

interface MyPluginConfig {
  enabled?: boolean;
}

export default definePlugin<MyPluginConfig>({
  name: 'my-plugin',
  metadata: {
    displayName: 'My Plugin',
  },
  // 声明本插件必须存在的资源；缺失会在装配阶段直接报错，而不是运行期才炸。
  requires: [],
  setup(context) {
    // 配置来自 Root 按 Plugin instance tree 物化的结果，字段在 schema.json 中声明。
    const config = context.config.get();

    const service: MyPluginService = {
      enabled: config.enabled ?? true,
      close() {
        /* 关闭连接等 */
      },
    };

    // 用 Scope + Token 暴露给本包的能力文件；它们通过执行上下文拿到，而非 import 单例。
    context.resources.provide(myPluginServiceToken, service);

    // 返回 disposer（等价于 context.lifecycle.add(...)）；generation 回滚时会被调用。
    return () => service.close();
  },
});
