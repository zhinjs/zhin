# 装饰器

:::warning
`TypeScript Decorator`本身就为实验性功能，暂未稳定。但是目前实际上已有很多框架诸如[`Nest.js`](https://nestjs.com)、[`Midway`](https://www.midwayjs.org/)等框架已经用上很久了，所以暂且先出版本，观望观望。
:::

> 由于装饰器的实验性性质，因此目前仍然处于分包的形式存在在Zhin中。欢迎大家[点击此处](https://github.com/zhinjs/decorator/issues)提交issue。

## 安装

请先参考[安装Zhin机器人](/guide/start.html)创建一个机器人。创建好之后，执行：

::: code-group
```sh [pnpm]
pnpm install @zhinjs/decorator
```

```sh [yarn]
yarn add @zhinjs/decorator
```

```sh [npm]
npm install @zhinjs/decorator
```
:::

然后在项目根目录创建一个`tsconfig.json`文件(如果已经有了那么请照葫芦画瓢一下，把这两项给加上)：

```json
{
  "compilerOptions": {
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true
  }
}
```

将上面的两项设置为`true`。

## 使用

熟悉Spring/Nest/Midway等的的开发者应该会很熟悉。

您可以将@Plugin看成是@Controller。

## 撰写一个插件

``` typescript
// plugins/repeater/index.ts
import {
  Command,
  CommandDesc,
  CommandOption,
  CommandSugar,
  Inject,
  InjectContext,
  InjectPlugin,
  MessagePattern,
  Middleware,
  Plugin,
  CommandRunTime,
} from "@zhinjs/decorator";
import { Next } from "koa";
import { Session, Context, Plugin as IPlugin } from "zhin";
import { RepeaterService } from "./repeater.service";

@Plugin
export default class Repeater {
  // * 注入Plugin Class
  @InjectPlugin
  private readonly plugin: IPlugin;
  // * 注入ctx上下文
  @InjectContext
  private readonly ctx: Context;
  // * 注入一个“服务类”，下面会有说明
  @Inject(RepeaterService)
  private readonly repeaterService: RepeaterService;

  // * 定义一个中间件。
  // !不能与@MessagePattern等交叉混用
  @Middleware
  aMiddleware(seesion: Session, next: Next) {
    seesion.reply(this.repeaterService.getMessage("middleware"));
    next();
  }

  // * 监听消息事件。允许同一个方法上有多个@MessagePattern
  @MessagePattern("icqq.message")
  onMessageReceived(seesion: Session) {
    seesion.reply("监听到一条消息");
  }

  // 定义一个指令
  // !注意：注解是从下往上运行的；但是始终会按照一个顺序：`初始化命令->定义option->定义sugar->执行action`
  // * @CommandSugar是允许定义多个的
  @CommandSugar(/^来一首(.+)$/, {
    args: ["$1"],
    options: { platform: "qq", origin: true },
  })
  @CommandSugar("qq点歌", { options: { platform: "qq", origin: true } })
  // * @CommandOption是可以定义多个的
  @CommandOption("-o [origin:boolean]")
  @CommandOption("-p [platform:string]")
  @CommandOption("-s [singer:number]")
  // * 这是命令的描述
  @CommandDesc("命令的描述")
  // * @Command只能允许有一个；如果有多个会被上面的覆盖掉
  @Command("music <keyword:string>")
  defineCommand({ options, session }: CommandRunTime<{ platform: string; origin: boolean }>, keyword: string) {
    console.log(options);
    session.reply(options.origin);
  }
}
```

可以看到，使用装饰器方式写出来的插件会十分`清晰易懂`，不易写乱。

## 撰写一个服务

此处的`服务`指的是`服务类`，而非非zhin的`服务`，请勿搞混；

`服务类`的作用，是用于封装逻辑；比如访问数据库等某些增删改查的逻辑，就可以封装。

```typescript
// plugins/repeater/repeater.service.ts
import { Injectable } from "@zhinjs/decorator";

// 标记这是一个服务
// 按道理来说，这个@Injectable是可以和nestjs通用的哦～
// 但是我暂时没有测试过，但是十有八九是通用的，因为nest是可插拔的
@Injectable
export class RepeaterService {
  // 写一个方法
  getMessage(type: "pattern" | "middleware") {
    if (type === "pattern") {
      return "hello world! This is a Message Pattern's message!";
    } else if (type === "middleware") {
      return "hello world! This is a middleware message!";
    }
  }
}
```
