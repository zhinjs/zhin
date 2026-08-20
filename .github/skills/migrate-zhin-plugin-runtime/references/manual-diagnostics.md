# 人工诊断处理

`zhin runtime migrate extract --check` 对每个搬不动的注册产出一条诊断。只要还有
`manual` 或 `error`，`migrate status` 就停在 `blocked`。

自动迁移的底线是**语义等价可证明**：它只搬「模块顶层 + 闭包干净」的注册。一旦注册依赖了
文件里的其它绑定，搬过去就会变成另一段代码，所以它宁可停下来让人处理。下面按诊断分类。

## `<api>() runs outside module top level`

注册被包在 `if` / 循环 / 函数 / `async` 回调里，静态分析无法确定它是否执行、执行几次。

**怎么办**：让注册无条件存在，把"要不要生效"下沉为运行期判断。

```ts
// 旧：条件注册
if (config.enableProfile) {
  addCommand(new MessageCommand('profile').action(handler));
}
```

```ts
// 新：commands/profile.ts —— 命令始终存在，开关在执行时判断
export default defineCommand({
  description: 'Show current user profile',
  async execute(context) {
    if (!context.config.enableProfile) return;   // 或返回提示文案
    return handler(context);
  },
});
```

动态生成的一批命令（`for (const name of list) addCommand(...)`）无法用文件路由表达：
要么为每个固定名字建一个文件，要么改成一个带参数的命令
（`commands/item/[name].ts`，并在 `defineCommand({ params })` 中声明 `name` 的类型）在执行期分发。

## `Command action captures source bindings: a, b`

**最常见的阻塞项。** action 闭包引用了模块级变量（连接、缓存、计数器、配置对象）。
能力文件是独立发现、独立加载的，那些变量在新位置根本不存在；就算复制过去，也会变成
每个文件各持一份的副本，而不是共享的同一份状态。

**怎么办**：把共享状态提升为 owner Resource，在 `plugin.ts` 的 `setup()` 里 `provide`，
能力文件从执行上下文 `use`。

```ts
// 旧：模块级可变状态被 action 捕获
const cache = new Map<string, Profile>();
addCommand(new MessageCommand('profile').action(async (message) => {
  return cache.get(message.$sender.id)?.nickname ?? 'unknown';
}));
```

```ts
// 新 plugin.ts：状态成为 owner Resource
import { createToken, definePlugin } from 'zhin.js';

export const cacheToken = createToken<Map<string, Profile>>('my-plugin.cache');

export default definePlugin({
  name: 'my-plugin',
  setup(context) {
    const cache = new Map<string, Profile>();
    context.resources.provide(cacheToken, cache);
    return () => cache.clear();          // 生成回滚/热更新时清理
  },
});
```

```ts
// 新 commands/profile.ts：从上下文取，不 import 单例
import { defineCommand } from 'zhin.js/command';
import { cacheToken } from '../plugin.js';

export default defineCommand({
  description: 'Show current user profile',
  async execute(context) {
    // 能力上下文用 context.use(token)；context.resources 只在 setup() 里存在
    const cache = context.use(cacheToken);
    return cache.get(context.input.sender.id)?.nickname ?? 'unknown';
  },
});
```

被捕获的如果只是**纯函数或常量**，直接抽到 `src/` 里由两边 import 即可 —— 无状态的东西
不需要走 Resource。判断标准是：它是否可变、是否需要全插件共享同一份。

## 无法解析的命令模板

`commandRoute()` 解析不了的 pattern（运行期拼接、非字面量、含不支持的参数语法）会报诊断。

文件路由的对应关系：

```text
gh issue list                        -> commands/gh/issue/list.ts
gh pr <title:string=defaultTitle>    -> commands/gh/pr/[[title]].ts
```

文件名只声明参数形态（双方括号 `[[title]]` 表示可选），类型与默认值在
`defineCommand({ params })` 中声明；matcher 模式串 DSL 不变。

模板必须是字面量。运行期才知道的名字，改成参数化命令在 `execute` 里分发。

## 中间件 / 组件诊断

- **中间件**：一个文件一个中间件。旧代码里同一文件注册多个、或顺序依赖执行分支的，
  拆成多个文件并用 `order` 表达先后（越小越先）；入站用 `target: 'inbound'`，
  发送前改写用 `target: 'outbound'`。
- **组件**：`defineComponent()` 的渲染函数必须能独立成文件，**文件名即组件名**。
  旧代码里内联匿名函数、或依赖入口局部变量的，先抽成具名函数再迁移。

## 迁移后仍要人工确认的部分

静态分析覆盖不到、但会真实改变行为的：

- **注册与 disposer 的执行顺序**依赖分支的，语义可能变化。
- **权限链、matcher、运行期条件注册**没有等价的静态表达。
- **ComponentContext 或模板字符串里的空白**可能被代码生成改写，影响最终消息排版。
- **`schema.json` 默认值**要与旧 `declareConfig()` 的默认值逐字段核对。

处理顺序建议：先给旧行为补一个测试锁住表现，再把隐式依赖改成显式 config/resource，
最后迁移能力。这样每一步都有回归保护，出错时能立刻定位是哪一步改坏的。
