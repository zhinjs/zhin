# 尝试写一个复读 🐔 插件

到目前为止，我们虽然让 Zhin 运行起来了，但除了内置插件外，还没有任何功能，接下来，让我们通过实现一个复读机的小功能，来初步了解下 Zhin 插件开发的大体流程。

## 1. 创建插件（二选一）

### - 通过 cli 创建

此方式需要你安装了 Zhin 脚手架`@zhinjs/cli`

```shell
zhin new repeater # 此处 repeater 为插件名

# 或者
zhin new repeater -t # 如果你想使用 TS 进行开发，可增加 `-t` 选项，声明需要创建 TS 插件
```

### - 手动创建

```shell
# 进入插件目录
cd plugins

#创建一个存放插件的目录
mkdir repeater

#创建入口文件
touch index.js
```

完成创建后，插件目录大体如下：

::: code-group

```txt [手动创建]
plugins/
└─ repeater/                 test 插件
   ├─ index.js           程序主入口
   └─ package.json       包管理文件 (可选)
```

```txt [通过 cli 创建]
plugins/
└─ repeater/                 test 插件
   └─ src/                 资源目录 插件
      ├─ index.ts           程序主入口
      └─ package.json       包管理文件 (可选)
```

:::

::: warning
除非你创建了 package.json ，否则 index 文件名不能随意更改，不然会导致插件无法被检索。
:::

打开入口文件，并输入如下内容

::: code-group

```js [index.js]
module.exports = {
  name: "repeater",
  install(ctx) {},
};
```

```ts [src/index.ts]
import { Context } from "zhin";
export const name = "repeater";
export function install(ctx: Context) {}
```

:::

这个时候你就已经写好了一个插件，不需要任何额外操作，不过目前这个插件还什么都不能干，我们没有为其编写相应的交互逻辑。

## 2. 实现插件交互逻辑

相信你这个时候一定有很多疑问，因为这其中涉及到相当多的概念，`Plugin` 到底是什么？

::: info
当前章节仅提供示例，目的在于让你能自己编写出可以进行简单交互的插件。目前你无需关心这段代码是什么意思，后面会逐一介绍，所以不用着急，让我们继续。
:::

你可以参考下列代码段，在[上下文](/api/context)上添加一个[中间件](/api/middleware)，拦截[消息会话](/api/session)，并将[消息元素](/interface/element)原封不动回复给用户。

::: code-group

```js [index.js]
module.exports = {
  name: "repeater",
  install(ctx) {
    ctx.middleware(async (session, next) => {
      await session.reply(session.elements);
      next();
    });
  },
};
```

```ts [src/index.ts]
import { Context } from "zhin";
export const name = "repeater";
export function install(ctx: Context) {
  ctx.middleware(async (session, next) => {
    await session.reply(session.elements);
    next();
  });
}
```

:::

### 测试一下

<ChatHistory>
  <ChatMsg id="1659488338">hello</ChatMsg>
  <ChatMsg id="1689919782">hello</ChatMsg>
</ChatHistory>
