// @ts-nocheck — 说明性骨架：assets/ 不属于任何 package/tsconfig，下面的 import 在此目录无法解析。
// 请复制到真实插件包中使用。
//
// 目录结构（能力按目录发现，一个文件一个能力，均为 default export）：
//   my-plugin/
//     package.json        ← "zhin": { "protocol": 1, "type": "plugin", "entry": "./plugin.ts", ... }
//     plugin.ts           ← 本文件：只做装配与生命周期
//     commands/hello.ts   ← 命令（见文件末尾）
import { definePlugin } from 'zhin.js/plugin-runtime';

export default definePlugin({
  // 必须匹配 /^[a-z][a-z0-9-]*$/
  name: 'my-plugin',
  metadata: {
    displayName: 'My Plugin',
  },
  setup(context) {
    // context: { plugin, config, resources, lifecycle, handoff }
    // 这里只做装配；命令/中间件请放到对应能力目录，不要在此命令式注册。
    context.lifecycle.add(() => {
      // 释放本 setup 中获取的资源
    });
  },
});

// ── commands/hello.ts ────────────────────────────────────────────────────────
// 文件路径即命令路由：commands/hello.ts -> `hello`
//
// import { defineCommand } from 'zhin.js/command';
//
// export default defineCommand({
//   description: 'Example command',
//   execute({ params, args, input, config }) {
//     return `hello, ${params.name ?? 'world'}`;
//   },
// });
//
// 带参数的路由用 Next.js 风格方括号文件名，类型与默认值在 defineCommand({ params }) 中声明：
//   commands/hello/[[name]].ts   ->  `hello [name]`（可选；params: { name: { type: 'string', default: 'world' } }）
//   commands/hello/[name].ts     ->  `hello <name>`（必需；params: { name: { type: 'string' } }）
//   commands/gh/issue/list.ts    ->  `gh issue list`
