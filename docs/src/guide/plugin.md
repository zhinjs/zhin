::: info通过本节的阅读，你将了解到如何新建一个插件、使用zhin提供的api实现一些简
单的小功能，以及插件的发布 :::

## 插件类型

zhin的插件共分为 `本地插件` 和 `npm 插件` 两大类。

- 本地插件

本地插件将全部存放在根目录的 plugins 下。所有由你自己编写，并 仅供个人使用 的插
件就可以称为本地插件。

- npm 插件

npm 插件都是直接使用 `npm i` 命令安装，存放在 `node_modules` 目录下。是由我或者
其他开发者编写，上传至 `npmjs` 平台，为 **所有使用 zhin 框架的人** 提供服务。

还记得在初始化项目时输入的 `zhin init` 么，在界面会有一个选择安装插件的步骤，那
些插件就全部属于 `npm 插件`。

如果你对 npmjs 并不了解也没关系，在这里只会介绍本地插件的编写。但是如果你想对
zhin 有一个更深入的了解，还是需要熟悉 nodejs 及 npmjs 的基本原理。

## 新建插件

::: tip

1. zhin 同时支持使用javascript和typescript编写插件.

2. 为了更好的开发体验，建议使用typescript编写插件。

3. 并且在2.x版本后，支持使用`setup语法`编写插件，这将在后面的章节中介绍。:::
   zhin为开发者提供了两种方式来新建一个插件，分别是通过`cli`和`手动创建`。推荐使
   用`cli`创建，因为这样可以省去很多重复的工作。现在我们就来看看如何创建一个插
   件。

### 1. cli创建

- 此方式需要你安装了zhin脚手架`@zhinjs/cli`
- 如果你还没有安装，可以通过以下命令进行安装

```shell
npm i -g @zhinjs/cli
```

- 安装完成后，你就可以通过以下命令创建一个插件了

```shell
zhin new test -t # 此处test为插件名, -t选项表示使用ts进行开发, 如果不加-t选项, 则默认使用js进行开发，如果你想使用setup语法开发，可以加上-s选项
```

### 2. 手动创建

1. 手动创建插件需要你自己创建目录，然后在目录下创建`src`目录，最后在`src`目录下
   创建`index.ts`文件，这个文件就是插件的主入口文件。
2. 如果你想使用setup语法开发，则必须添加package.json文件，并在内容中添
   加`"setup": true`字段，否则zhin将会以普通插件的方式进行加载。

- 完成创建后，插件目录大体如下：::: code-group

```txt [JavaScript]
plugins/
└─ test/                 test 插件
   └─ index.js           程序主入口
   └─ package.json       包管理文件 (可选)
```

```txt [TypeScript]
plugins/
└─ test/                 test 插件
   ├─ src/               资源目录 插件
   │  └─ index.ts        程序主入口
   └─ package.json       包管理文件 (可选)
```

:::

- 后续章节中，我们将以`cli`创建的插件为例进行讲解，如果你使用手动创建的方式，也
  可以参考`cli`创建的插件进行开发。

## 插件开发

在开发之前，你可以先看看处理生成的默认插件代码，里面有一些注释，可以帮助你更好的
了解插件的开发。

### 1. 默认代码

::: code-group

```javascript [javascript]
// index.js
module.exports = {
  name: "js",
  /**
   *
   * @param ctx {import('zhin').Context} zhin的上下文
   * @return dispose {import('zhin').Dispose|void}
   */
  install(ctx) {
    // 在这儿实现你的插件逻辑
    // 功能样例：
    // 1.定义指令
    /*
        ctx.command('test')
            .option('foo','-f <bar:string>')
            .action(({session,options})=>{
                console.log('options',options);
                return 'hello world'
            })
        */
    // 2.定义中间件
    /*
        ctx.middleware(async (session,next)=>{
            if(true){ //需要判断的条件
            //逻辑执行代码
            }else{
                next() // 不next，则不会流入下一个中间件
            }
        });
        */
    // 3. 监听事件
    /*
        ctx.on(eventName,callback);
        ctx.once(eventName,callback);
        ctx.on(eventName,callback);
        */
    // 4. 定义服务
    /*
        ctx.service('serviceName',{}) // 往bot上添加可全局访问的属性
        */
    // 5. 添加自定插件副作用(在插件卸载时需要执行的代码)
    // 如果不需要，可以不return
    /*
        return ()=>{
            // 如果你使用过react的useEffect 那你应该知道这是在干嘛
            // 函数内容将会在插件卸载时自动卸载
        }
        */
  },
};
```

```typescript [typescript]
// src/index.ts
import { Plugin, Context } from "zhin";
export const name = "ts";
export function install(this: Plugin, ctx: Context) {
  // 在这儿实现你的插件逻辑
  // 功能样例：
  //1.定义指令
  /*
    ctx.command('test')
        .option('foo','-f <bar:string>')
        .action(({session,options})=>{
            console.log('options',options);
            return 'hello world'
        })
    */
  // 2.定义中间件
  /*
    ctx.middleware(async (session,next)=>{
        if(true){ //需要判断的条件
        //逻辑执行代码
        }else{
            next() // 不next，则不会流入下一个中间件
        }
    });
    */
  // 3. 监听事件
  /*
    ctx.on(eventName,callback);
    ctx.once(eventName,callback);
    ctx.on(eventName,callback);
    */
  // 4. 定义服务
  /*
    ctx.service('serviceName',{}) // 往bot上添加可全局访问的属性
    */
  // 5. 添加自定插件副作用(在插件卸载时需要执行的代码)
  // 如果不需要，可以不return
  /*
    return ()=>{
        // 如果你使用过react的useEffect 那你应该知道这是在干嘛
        // 函数内容将会在插件卸载时自动卸载
    }
    */
}
```

```javascript [javascript-setup]
// index.js
const { useContext } = require("zhin");
const ctx = useContext();
// 在这儿实现你的插件逻辑
// 功能样例：
// 1.定义指令
/*
ctx.command('test')
    .option('foo','-f <bar:string>')
    .action(({session,options})=>{
        console.log('options',options);
        return 'hello world'
    })
*/
// 2.定义中间件
/*
ctx.middleware(async (session,next)=>{
    if(true){ //需要判断的条件
        //逻辑执行代码
    }else{
        next() // 不next，则不会流入下一个中间件
    }
});
*/
// 3. 监听事件
/*
ctx.on(eventName,callback);
ctx.once(eventName,callback);
ctx.on(eventName,callback);
*/
// 4. 定义服务
/*
ctx.service('serviceName',{}) // 往bot上添加可全局访问的属性
*/
// 5. 添加自定插件副作用(在插件卸载时需要执行的代码)
// 如果不需要，可以不return
/*
ctx.on('dispose',()=>{
    // 如果你使用过react的useEffect 那你应该知道这是在干嘛
    // 函数内容将会在插件卸载时自动卸载
})
*/
```

```typescript [typescript-setup]
// src/index.ts
import { useContext } from "zhin";

const ctx = useContext();

//1.定义指令
/*
ctx.command('test')
    .option('foo','-f <bar:string>')
    .action(({session,options})=>{
        console.log('options',options);
        return 'hello world'
    })
*/
// 2.定义中间件
/*
ctx.middleware(async (session,next)=>{
    if(true){ //需要判断的条件
        //逻辑执行代码
    }else{
        next() // 不next，则不会流入下一个中间件
    }
});
*/
// 3. 监听事件
/*
ctx.on(eventName,callback);
ctx.once(eventName,callback);
ctx.on(eventName,callback);
*/
// 4. 定义服务
/*
ctx.service('serviceName',{}) // 往bot上添加可全局访问的属性
*/
// 5. 添加自定插件副作用(在插件卸载时需要执行的代码)
// 如果不需要，可以不return
/*
ctx.on('dispose',()=>{
    // 如果你使用过react的useEffect 那你应该知道这是在干嘛
    // 函数内容将会在插件卸载时自动卸载
})
*/
```

:::

### 2. 功能实现

接下来，我们来实现一些功能，让你更好的理解插件的使用方法

### 2.1 定义指令

::: code-group

```javascript [javascript]
// index.js
module.exports = {
  name: "test",
  /**
   *
   * @param ctx {import('zhin').Context} zhin的上下文
   * @return dispose {import('zhin').Dispose|void} 插件卸载时需要执行的代码
   */
  install(ctx) {
    ctx
      .command("test")
      .option("-f <foo:string>")
      .action(({ session, options }, foo) => {
        console.log("options", options);
        return "hello world";
      });
  },
};
```

```typescript [typescript]
// src/index.ts
import { Plugin } from "zhin";
export const name = "test";
export function install(this: Plugin, ctx: Context) {
  ctx
    .command("test")
    .option("-f <foo:string>")
    .action(({ session, options }, foo) => {
      console.log("options", options);
      return "hello world";
    });
}
```

```javascript [javascript-setup]
// index.js
const { useContext } = require("zhin");
const ctx = useContext();
ctx
  .command("test")
  .option("-f <foo:string>")
  .action(({ session, options }, foo) => {
    console.log("options", options);
    return "hello world";
  });
```

```typescript [typescript-setup]
// src/index.ts
import { useContext } from "zhin";
const ctx = useContext();
ctx
  .command("test")
  .option("-f <foo:string>")
  .action(({ session, options }, foo) => {
    console.log("options", options);
    return "hello world";
  });
```

::: 现在，你可以给bot发送`test -f hello`来测试一下了（如果对应bot有配置prefix，
需要在发送的指令前边加上对应prefix）

### 2.2 定义中间件

::: code-group

```javascript [javascript]
// index.js
module.exports = {
  name: "test",
  /**
   *
   * @param ctx {import('zhin').Context} zhin的上下文
   * @return dispose {import('zhin').Dispose|void} 插件卸载时需要执行的代码
   */
  install(ctx) {
    ctx.middleware(async (session, next) => {
      if (true) {
        //需要判断的条件
        //逻辑执行代码
      } else {
        next(); // 不next，则不会流入下一个中间件
      }
    });
  },
};
```

```typescript [typescript]
// src/index.ts
import { Plugin } from "zhin";
export const name = "test";
export function install(this: Plugin, ctx: Context) {
  ctx.middleware(async (session, next) => {
    if (true) {
      //需要判断的条件
      //逻辑执行代码
    } else {
      next(); // 不next，则不会流入下一个中间件
    }
  });
}
```

```javascript [javascript-setup]
// index.js
const { useContext } = require("zhin");
const ctx = useContext();
ctx.middleware(async (session, next) => {
  if (true) {
    //需要判断的条件
    //逻辑执行代码
  } else {
    next(); // 不next，则不会流入下一个中间件
  }
});
```

```typescript [typescript-setup]
// src/index.ts
import { useContext } from "zhin";
const ctx = useContext();
ctx.middleware(async (session, next) => {
  if (true) {
    //需要判断的条件
    //逻辑执行代码
  } else {
    next(); // 不next，则不会流入下一个中间件
  }
});
```

::: ::: info如果你使用过koa，那么你应该知道这是在干嘛

如果你不知道，那么你可以看看[这里](https://koa.bootcss.com/#context) :::

### 2.3 监听事件

::: code-group

```javascript [javascript]
// index.js
module.exports = {
  name: "test",
  /**
   *
   * @param ctx {import('zhin').Context} zhin的上下文
   * @return dispose {import('zhin').Dispose|void} 插件卸载时需要执行的代码
   */
  install(ctx) {
    ctx.on("message", ({ session }) => {
      console.log("message", session.message);
    });
  },
};
```

```typescript [typescript]
// src/index.ts
import { Plugin } from "zhin";
export const name = "test";
export function install(this: Plugin, ctx: Context) {
  ctx.on("message", ({ session }) => {
    console.log("message", session.message);
  });
}
```

```javascript [javascript-setup]
// index.js
const { useContext } = require("zhin");
const ctx = useContext();
ctx.on("message", ({ session }) => {
  console.log("message", session.message);
});
```

```typescript [typescript-setup]
// src/index.ts
import { useContext } from "zhin";
const ctx = useContext();
ctx.on("message", ({ session }) => {
  console.log("message", session.message);
});
```

::: 可监听的事件及返回参数可以参考[事件地图](/api/event/map)

### 2.4 定义服务

::: code-group

```javascript [javascript]
// index.js
module.exports = {
  name: "test",
  /**
   *
   * @param ctx {import('zhin').Context} zhin的上下文
   * @return dispose {import('zhin').Dispose|void} 插件卸载时需要执行的代码
   */
  install(ctx) {
    ctx.service("test", {
      foo: "bar",
    });
  },
};
```

```typescript [typescript]
// src/index.ts
import { Plugin } from "zhin";
export const name = "test";
declare module "zhin" {
  namespace Zhin {
    interface Services {
      test: {
        foo: string;
      };
    }
  }
}
export function install(this: Plugin, ctx: Context) {
  ctx.service("test", {
    foo: "bar",
  });
}
```

```javascript [javascript-setup]
// index.js
const { useContext } = require("zhin");
const ctx = useContext();
ctx.service("test", {
  foo: "bar",
});
```

```typescript [typescript-setup]
// src/index.ts
import { useContext } from "zhin";
const ctx = useContext();
declare module "zhin" {
  namespace Zhin {
    interface Services {
      test: {
        foo: string;
      };
    }
  }
}
ctx.service("test", {
  foo: "bar",
});
```

::: ::: tip服务名不可重复，否则会报错

服务名不可为zhin内置的服务名，否则会报错

内置服务可参考[内置服务](/api/service) :::

### 2.5 使用自定义服务

::: code-group

```javascript [javascript]
// index.js
module.exports = {
  name: "test",
  /**
   *
   * @param ctx {import('zhin').Context} zhin的上下文
   * @return dispose {import('zhin').Dispose|void} 插件卸载时需要执行的代码
   */
  install(ctx) {
    ctx.command("test").action(({ session }) => {
      console.log("service", ctx.test);
    });
  },
};
```

```typescript [typescript]
// src/index.ts
import { Plugin } from "zhin";
export const name = "test";
export function install(this: Plugin, ctx: Context) {
  ctx.command("test").action(({ session }) => {
    console.log("service", ctx.test);
  });
}
```

```javascript [javascript-setup]
// index.js
const { useContext } = require("zhin");
const ctx = useContext();
ctx.command("test").action(({ session }) => {
  console.log("service", ctx.test);
});
```

```typescript [typescript-setup]
// src/index.ts
import { useContext } from "zhin";
const ctx = useContext();
ctx.command("test").action(({ session }) => {
  console.log("service", ctx.test);
});
```

::: ::: tip如果你使用了typescript，那么你需要在使用服务前声明服务的类型，否则会
报错 :::

### 2.6 生命周期

::: code-group

```javascript [javascript]
// index.js
module.exports = {
  name: "test",
  /**
   *
   * @param ctx {import('zhin').Context} zhin的上下文
   * @return dispose {import('zhin').Dispose|void} 插件卸载时需要执行的代码
   */
  install(ctx) {
    console.log("install");
    return () => {
      console.log("dispose");
    };
  },
};
```

```typescript [typescript]
// src/index.ts
import { Plugin } from "zhin";
export const name = "test";
export function install(this: Plugin, ctx: Context) {
  console.log("install");
  return () => {
    console.log("dispose");
  };
}
```

```javascript [javascript-setup]
// index.js
const { useContext, onDispose } = require("zhin");
const ctx = useContext();
console.log("install");
onDispose(() => {
  console.log("dispose");
});
```

```typescript [typescript-setup]
// src/index.ts
import { useContext, onDispose } from "zhin";
const ctx = useContext();
console.log("install");
onDispose(() => {
  console.log("dispose");
});
```

::: 除此之外，在setup语法中，你还可以使用useEffect来监听生命周期 ::: code-group

```javascript [javascript-setup]
// index.js
const { useContext, useEffect } = require("zhin");
useEffect(() => {
  const ctx = useContext();
  console.log("install");
  return () => {
    console.log("dispose");
  };
});
```

```typescript [typescript-setup]
// src/index.ts
import { useContext, useEffect } from "zhin";
useEffect(() => {
  const ctx = useContext();
  console.log("install");
  return () => {
    console.log("dispose");
  };
});
```

:::

### 2.7. 获取zhin.yaml中的指定配置

假设zhin.yaml中有如下配置

```yaml
test:
  foo: bar
```

::: code-group

```javascript [javascript]
// index.js
const { useOption } = require("zhin");
module.exports = {
  name: "test",
  /**
   *
   * @param ctx {import('zhin').Context} zhin的上下文
   * @return dispose {import('zhin').Dispose|void} 插件卸载时需要执行的代码
   */
  install(ctx) {
    const option = useOption("test"); // 获取zhin.yaml中的test配置
    console.log(option);
  },
};
```

```typescript [typescript]
// src/index.ts
import { Plugin } from "zhin";
import { useOption } from "zhin";
export const name = "test";
export function install(this: Plugin, ctx: Context) {
  const option = useOption("test"); // 获取zhin.yaml中的test配置
  console.log(option);
}
```

```javascript [javascript-setup]
// index.js
const { useContext } = require("zhin");
const ctx = useContext();
const option = ctx.option("test"); // 获取zhin.yaml中的test配置
console.log(option);
```

```typescript [typescript-setup]
// src/index.ts
import { useContext } from "zhin";
const ctx = useContext();
const option = ctx.option("test"); // 获取zhin.yaml中的test配置
console.log(option);
```

::: 在setup中，你还可以使用useEffect来监听配置的变化 ::: code-group

```javascript [javascript-setup]
// index.js
const { useContext, useEffect } = require("zhin");
const ctx = useContext();
const option = ctx.option("test"); // 获取zhin.yaml中的test配置
useEffect((newOption, oldOption) => {
  console.log(option);
}, option);
```

```typescript [typescript-setup]
// src/index.ts
import { useContext, useEffect } from "zhin";
const ctx = useContext();
const option = ctx.option("test"); // 获取zhin.yaml中的test配置
useEffect((newOption, oldOption) => {
  console.log(option);
}, option);
```

::: 在配置变化时，useEffect会被调用，第一个参数为新的配置，第二个参数为旧的配置
