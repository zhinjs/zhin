# 内置适配器(adapter-icqq)

## icqq由来

在介绍该适配器之前，我想先让你了解一下什么是 `icqq`，相信知道 `QQ` `NodeJS` 机器人生态的都知道 `oicq`，他是有`takayama-lily` 大佬维护的 qq 机器人的 SDK。奈何近一年来，大佬似乎琐事产生，没空更新了，我们变自发开始维护起来，而 `icqq` 就是所有维护分支中的其中之一，他在保留原有 `oicq` api 的同时增加了**频道**、**加精/取消加精群消息**的 API，并优化了登录流程（createClient 不再传 uin，在 login 时才传递），更改了底层发布订阅的 EventEmitter为TripTrap，使得使用过滤器监听事件得以实现。

## adapter-icqq的优势

而 `adapter-icqq` 则是能让你直接在 zhin 中登录使用 icqq 登录个人账号，来作为 qq 机器人的适配器，它不像 `go-cqhhtp` 和 `miral-go` 那样，需要你重新启动一个进程而是和 `zhin`使用同一个进程工作，并且，你可以使用 zhin 去调用 `icqq` 底层的api，来实现更多功能。

说了这么多，那怎么配置呢？

## 接入到zhin

- `adapter-icqq`作为内置适配器，接入到zhin十分的简单
- 你只需要在配置文件`zhin.yaml`的`adapters`中增加如下配置，即可接入一个qq账号：

```yaml

adapters:
  icqq: # 指定使用icqq适配器 // [!code ++]
    bots: // [!code ++]
      - self_id: 147258369 # 机器人账号 // [!code ++]
        platform: 5 # 指定qq登录平台为iPad（可不配置  1：安卓  2：安卓平板  3：手表  4：苹果电脑  5：苹果平板） // [!code ++]
```

- 其中 `self_id` 对应`icqq` 的 uin，作为一个机器人的唯一标识
- `platform` 代表你要登录的平台，默认为 1

::: tip
具体更多的配置，请参考 icqq 的[Config](https://icqqjs.github.io/icqq/interfaces/Config.html)
:::

完成配置后，重启 zhin，将自动开始启动 icqq，当遇到验证时，内置的 `login` 插件，将提供命令行辅助你完成登录的功能。
