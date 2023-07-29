# 服务(Service)

::: tip服务只是zhin的一个概念 :::

## 介绍

- 为[知音](#知音--zhin-)添加的**任何**[上下文](#上下文--context-)都可以访问的属
  性

## 如何定义？

- 在插件中，通过上下文定义 ::: code-group

```typescript
import { Context } from "zhin";

class CustomeService {
  constructor(public config: any) {}
  getConfig() {
    return this.config;
  }
  setconfig(config: any) {
    this.config = config;
  }
}
// 定义类型声明合并
declare module "zhin" {
  namespace Zhin {
    interface Services {
      custom: CustomeService;
    }
  }
}

export function install(ctx: Context) {
  // 如果上面没定义类型声明合并，这儿会报错
  ctx.service("custom", new CustomeService("hello"));
}
```

```javascript

class CustomeService {
    constructor(config) {
        this.config=config
    }

    getConfig() {
        return this.config
    }

    setconfig(config: any) {
        this.config = config
    }
}

module.exports = {
    install(ctx) {
        ctx.service('custom',new CustomeService('hello'))
    }
}
```

:::

## 如何使用?

- 在其他插件中，直接使用ctx[serviceName]使用 ::: code-group

```typescript
import { Context } from "zhin";
export const use = ["custom"]; // 定义这个，可以确保只有在custom服务正常时，插件才启用
export function install(ctx: Context) {
  const oldConfig = ctx.custom.getConfig();
  ctx.custom.setConfig("hi");
  const newConfig = ctx.custom.getConfig();
  console.log(oldConfig, newConfig);
}
```

```javascript
module.exports = {
  use: ["custom"], // 定义这个，可以确保只有在custom服务正常时，插件才启用
  install(ctx) {
    const oldConfig = ctx.custom.getConfig();
    ctx.custom.setConfig("hi");
    const newConfig = ctx.custom.getConfig();
    console.log(oldConfig, newConfig);
  },
};
```

:::
