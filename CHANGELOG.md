# Changelog

## [2.3.8](https://github.com/zhinjs/zhin/compare/v2.3.7...v2.3.8) (2023-07-29)


### Bug Fixes

* middleware not remove when context dispose ([4aaefa3](https://github.com/zhinjs/zhin/commit/4aaefa3c395c76c05c93be4b283ff21ddd36a219))

## [2.3.7](https://github.com/zhinjs/zhin/compare/v2.3.6...v2.3.7) (2023-07-22)


### Bug Fixes

* command参数验证错误 ([af10abc](https://github.com/zhinjs/zhin/commit/af10abc1ced7ba5a284f81eb93b03725495a0de6))

## [2.3.6](https://github.com/zhinjs/zhin/compare/v2.3.5...v2.3.6) (2023-07-22)


### Bug Fixes

* fix md err & typo error ([eb6e855](https://github.com/zhinjs/zhin/commit/eb6e8555284ad03a2eca276900194e772595316c))
* 内置适配器优化，格式化控制台输入输出，修复内置类型user_id错误 ([652d029](https://github.com/zhinjs/zhin/commit/652d029d7f1860ab82a6896c297f19e036e2481b))
* 服务生命周期优化 ([b1189af](https://github.com/zhinjs/zhin/commit/b1189af709c08227cdda60d515c8a1047ba0d215))
* 生命周期优化 ([0a41a27](https://github.com/zhinjs/zhin/commit/0a41a274e3c81ceb7cb1384bf7442ffbccc1801c))
* 生命周期优化 ([a000836](https://github.com/zhinjs/zhin/commit/a000836a1bbf566c895bee80163448e1a4ecfcf1))
* 生命周期类型优化 ([c15c6d1](https://github.com/zhinjs/zhin/commit/c15c6d1d8530a4eb04b640e2a1b0a0ec3d62a92b))

## [2.3.5](https://github.com/zhinjs/zhin/compare/v2.3.4...v2.3.5) (2023-07-19)


### Bug Fixes

* 保护更多危险变量 ([a701f1b](https://github.com/zhinjs/zhin/commit/a701f1bf361dda4a854c1adc5ec43bdae5815762))

## [2.3.4](https://github.com/zhinjs/zhin/compare/v2.3.3...v2.3.4) (2023-07-19)


### Bug Fixes

* 嵌套标签解析错误 ([0c64975](https://github.com/zhinjs/zhin/commit/0c64975db9ca250fcf1aa16af9b8a4008a8a9068))

## [2.3.3](https://github.com/zhinjs/zhin/compare/v2.3.2...v2.3.3) (2023-07-19)


### Bug Fixes

* 修复内置组件prompt错误 ([ce7ae54](https://github.com/zhinjs/zhin/commit/ce7ae543366e4c59c4b44bb8096afc99ab6b0abd))

## [2.3.2](https://github.com/zhinjs/zhin/compare/v2.3.1...v2.3.2) (2023-07-18)


### Bug Fixes

* jsx Runtime ([bca1225](https://github.com/zhinjs/zhin/commit/bca1225c9638673de4703f6c825ba5e8689e92e2))
* update docs ([8fa5320](https://github.com/zhinjs/zhin/commit/8fa53203a630cf7d9b629a97a136dd5c9bd7db4d))
* 优化command注册数据类型流程； ([1ae2956](https://github.com/zhinjs/zhin/commit/1ae2956de96cd74d49c12886f3f4bcab3bda1ab2))
* 内置组件语法优化，修复函数式组件类型错误 ([fc29bb1](https://github.com/zhinjs/zhin/commit/fc29bb189a2ac59a0dc572f74bc00e41aa5d6988))
* 函数组件支持异步 ([fc65c92](https://github.com/zhinjs/zhin/commit/fc65c92420a7ae764a8680f962e65af35eac75c2))
* 支持函数式组件，增强代码健壮性 ([b620625](https://github.com/zhinjs/zhin/commit/b620625715e4e41763c33a002bdce742335f62af))

## [2.3.1](https://github.com/zhinjs/zhin/compare/v2.3.0...v2.3.1) (2023-07-16)


### Bug Fixes

* daemon 增加zhin升级指令(update)，可快速升级zhin到指定版本 ([0b9e5a5](https://github.com/zhinjs/zhin/commit/0b9e5a54b21bc5b3571e26cf8776842e7e426203))

## [2.3.0](https://github.com/zhinjs/zhin/compare/v2.2.1...v2.3.0) (2023-07-16)


### Features

* 指令筛选功能初版 ([7929f91](https://github.com/zhinjs/zhin/commit/7929f914d3244582367d30e5f3989e294d3d1c63))
* 重构command，破坏更新，请谨慎升级，与旧版command不兼容 ([8a2f644](https://github.com/zhinjs/zhin/commit/8a2f644a335053042a0a76d9c8de677d23f76fa4))


### Bug Fixes

* fix:  ([36df4f0](https://github.com/zhinjs/zhin/commit/36df4f009c1d9df140c5595acd5c8f960ba5c5bd))
* 1.更新文档， ([47714ba](https://github.com/zhinjs/zhin/commit/47714baa5c3575d1477c7e08e67e84ab03fe1187))
* allow loop and when ([1313491](https://github.com/zhinjs/zhin/commit/1313491ad8f625a19a9a057ea08d731a8a73bbf6))
* baseType add user_id,set command action return string ([29dbfd7](https://github.com/zhinjs/zhin/commit/29dbfd75f21c16facec5464f78439a10a91d69ca))
* bug fix ([7cf19ff](https://github.com/zhinjs/zhin/commit/7cf19ff2755328cb438e2a4e7f6b2315c0c29f1c))
* bug fix ([4840c91](https://github.com/zhinjs/zhin/commit/4840c91d1c96e2e3de5bf08eac1a499721fb835a))
* built plugin(config) error ([93a3f9b](https://github.com/zhinjs/zhin/commit/93a3f9b1888d5333b27efa47924a41fdf74044c2))
* element transform bug ([fb00359](https://github.com/zhinjs/zhin/commit/fb00359ff6c09ab7a43654578dc506b3629f6c49))
* execute组件错误 ([f489715](https://github.com/zhinjs/zhin/commit/f48971502876c09f854d69b5238785d9ab693b36))
* fake console ([c96b88a](https://github.com/zhinjs/zhin/commit/c96b88a3c59eaeb911a9a3f6f374cd2e75bb179b))
* fake global ([dfa70e2](https://github.com/zhinjs/zhin/commit/dfa70e2c21e9d32c15df0bd7c98fb5960f2b763c))
* icqq isAtMe bug ([8b29abb](https://github.com/zhinjs/zhin/commit/8b29abb6145a99872bd7895e8a57cd7ee2ba0508))
* plugin load error ([052151e](https://github.com/zhinjs/zhin/commit/052151e7dfe466a8fec9c00d9163317067c152d9))
* type error ([9557d14](https://github.com/zhinjs/zhin/commit/9557d14ba8639f2546ec84e14142edb1b9e4f397))
* 上下文过滤bug修复 ([36d6da3](https://github.com/zhinjs/zhin/commit/36d6da3f1ab204b22adc95f0ca7aad4452570b91))
* 优化plugin文本 ([adc75d4](https://github.com/zhinjs/zhin/commit/adc75d4cf41d059ca693108be7407e40bec4130a))
* 修复版本号错误 ([40531fd](https://github.com/zhinjs/zhin/commit/40531fd70a1709efbe083cb9a335efc9a2384ec6))
* 允许定义指令时，通过/定义父级指令 ([269ab97](https://github.com/zhinjs/zhin/commit/269ab974e658a889f9735e626f8a9ddf0c0bf0ee))
* 内置类型增加json、function ([b38b9ca](https://github.com/zhinjs/zhin/commit/b38b9ca779ea1c3fb5a6144cc8085f7d48da9327))
* 内置类型增加json、function ([7b6169f](https://github.com/zhinjs/zhin/commit/7b6169ff7f5b39cae85b1a0ada308d539cd46168))
* 参数/选项类型判断错误 ([b32eeee](https://github.com/zhinjs/zhin/commit/b32eeeec1e5b3ef91effffb98c43d612c20c5078))
* 参数类型添加integer ([052d105](https://github.com/zhinjs/zhin/commit/052d10598a9cdb26d4ceeb3498bdd2bc6582e413))
* 同步更改内置指令 ([3b2b26c](https://github.com/zhinjs/zhin/commit/3b2b26c6678c2f385fbb926a1fc74a372eb920ee))
* 增加图片、语音、视频云端加载方案 ([1e2dd39](https://github.com/zhinjs/zhin/commit/1e2dd39e47b98225982cd901568369c930dec1c3))
* 子进程管道错误 ([35eebb8](https://github.com/zhinjs/zhin/commit/35eebb8806cc2a352928fc97338b96efde746c2d))
* 子进程管道错误 ([6820c7a](https://github.com/zhinjs/zhin/commit/6820c7a9435ded46f4f73d79715e630472d655d6))
* 子进程管道错误 ([9ddcba8](https://github.com/zhinjs/zhin/commit/9ddcba839584eba575bf23fff29461e4dae0a1ef))
* 将icqq 移入peerDependencies，并指定为最新版本(latest) ([d3eecdf](https://github.com/zhinjs/zhin/commit/d3eecdf39d76aa5840a007026fe26f3d53140c09))
* 指令解析优化，elementBuffer传输错误 ([f06ee2b](https://github.com/zhinjs/zhin/commit/f06ee2ba75e07750cdb75f79b3a7b9bf75e53ba8))
* 日志优化 ([5a09713](https://github.com/zhinjs/zhin/commit/5a09713bda0782f35d1cbe0cb895cccd4307325b))
* 消息限速、文本超长自动转发 ([a1db268](https://github.com/zhinjs/zhin/commit/a1db26810c707946ed9d02b2c3308910d62cf2f7))
* 登录失败输出错误信息,指令定义错误 ([49a7986](https://github.com/zhinjs/zhin/commit/49a7986f0a90be08f83cd58130f28b6dabb6745c))
* 类型补充 ([5749c35](https://github.com/zhinjs/zhin/commit/5749c355732d9fbf8e2deb95cd7cd99378d36e9a))
* 系统保护 ([6a7f289](https://github.com/zhinjs/zhin/commit/6a7f28929948be128e3817b55ef766367c992705))
* 调试参数移除 ([e562917](https://github.com/zhinjs/zhin/commit/e5629178bde125b6d0280897c4bc6f84ef1310c0))
* 返回值允许是boolean、number ([6948dbf](https://github.com/zhinjs/zhin/commit/6948dbfd45238a1e38a0491d9fcec7fb66d41faa))
* 返回值允许是boolean、number ([2c965e3](https://github.com/zhinjs/zhin/commit/2c965e3062ba8fb6274b44f22dc560fba0b39ad9))
* 适配器引用错误 ([aeb9459](https://github.com/zhinjs/zhin/commit/aeb9459493a6a64e8de54185d2d320a5c8ae0e3f))
* 默认指令写法更改 ([387582f](https://github.com/zhinjs/zhin/commit/387582fb5992fb20d80aff7071468a09e8443830))

## [2.2.1](https://github.com/zhinjs/zhin/compare/v2.2.0...v2.2.1) (2023-07-16)


### Bug Fixes

* 1.更新文档， ([47714ba](https://github.com/zhinjs/zhin/commit/47714baa5c3575d1477c7e08e67e84ab03fe1187))
* icqq isAtMe bug ([8b29abb](https://github.com/zhinjs/zhin/commit/8b29abb6145a99872bd7895e8a57cd7ee2ba0508))
* 优化plugin文本 ([adc75d4](https://github.com/zhinjs/zhin/commit/adc75d4cf41d059ca693108be7407e40bec4130a))

## [2.2.0](https://github.com/zhinjs/zhin/compare/v2.1.12...v2.2.0) (2023-06-30)


### Features

* 指令筛选功能初版 ([7929f91](https://github.com/zhinjs/zhin/commit/7929f914d3244582367d30e5f3989e294d3d1c63))


### Bug Fixes

* 指令解析优化，elementBuffer传输错误 ([f06ee2b](https://github.com/zhinjs/zhin/commit/f06ee2ba75e07750cdb75f79b3a7b9bf75e53ba8))
* 调试参数移除 ([e562917](https://github.com/zhinjs/zhin/commit/e5629178bde125b6d0280897c4bc6f84ef1310c0))

## [2.1.12](https://github.com/zhinjs/zhin/compare/v2.1.11...v2.1.12) (2023-06-21)


### Bug Fixes

* execute组件错误 ([f489715](https://github.com/zhinjs/zhin/commit/f48971502876c09f854d69b5238785d9ab693b36))

## [2.1.11](https://github.com/zhinjs/zhin/compare/v2.1.10...v2.1.11) (2023-06-21)


### Bug Fixes

* 登录失败输出错误信息,指令定义错误 ([49a7986](https://github.com/zhinjs/zhin/commit/49a7986f0a90be08f83cd58130f28b6dabb6745c))

## [2.1.10](https://github.com/zhinjs/zhin/compare/v2.1.9...v2.1.10) (2023-06-16)


### Bug Fixes

* 子进程管道错误 ([35eebb8](https://github.com/zhinjs/zhin/commit/35eebb8806cc2a352928fc97338b96efde746c2d))
* 子进程管道错误 ([6820c7a](https://github.com/zhinjs/zhin/commit/6820c7a9435ded46f4f73d79715e630472d655d6))

## [2.1.9](https://github.com/zhinjs/zhin/compare/v2.1.8...v2.1.9) (2023-06-16)


### Bug Fixes

* 子进程管道错误 ([9ddcba8](https://github.com/zhinjs/zhin/commit/9ddcba839584eba575bf23fff29461e4dae0a1ef))

## [2.1.8](https://github.com/zhinjs/zhin/compare/v2.1.7...v2.1.8) (2023-06-13)


### Bug Fixes

* 内置类型增加json、function ([b38b9ca](https://github.com/zhinjs/zhin/commit/b38b9ca779ea1c3fb5a6144cc8085f7d48da9327))
* 内置类型增加json、function ([7b6169f](https://github.com/zhinjs/zhin/commit/7b6169ff7f5b39cae85b1a0ada308d539cd46168))

## [2.1.7](https://github.com/zhinjs/zhin/compare/v2.1.6...v2.1.7) (2023-06-13)


### Bug Fixes

* 上下文过滤bug修复 ([36d6da3](https://github.com/zhinjs/zhin/commit/36d6da3f1ab204b22adc95f0ca7aad4452570b91))

## [2.1.6](https://github.com/zhinjs/zhin/compare/v2.1.5...v2.1.6) (2023-06-12)


### Bug Fixes

* bug fix ([7cf19ff](https://github.com/zhinjs/zhin/commit/7cf19ff2755328cb438e2a4e7f6b2315c0c29f1c))

## [2.1.5](https://github.com/zhinjs/zhin/compare/v2.1.4...v2.1.5) (2023-06-12)


### Bug Fixes

* bug fix ([4840c91](https://github.com/zhinjs/zhin/commit/4840c91d1c96e2e3de5bf08eac1a499721fb835a))

## [2.1.4](https://github.com/zhinjs/zhin/compare/v2.1.3...v2.1.4) (2023-06-12)


### Bug Fixes

* 参数类型添加integer ([052d105](https://github.com/zhinjs/zhin/commit/052d10598a9cdb26d4ceeb3498bdd2bc6582e413))

## [2.1.3](https://github.com/zhinjs/zhin/compare/v2.1.2...v2.1.3) (2023-06-12)


### Bug Fixes

* 返回值允许是boolean、number ([6948dbf](https://github.com/zhinjs/zhin/commit/6948dbfd45238a1e38a0491d9fcec7fb66d41faa))
* 返回值允许是boolean、number ([2c965e3](https://github.com/zhinjs/zhin/commit/2c965e3062ba8fb6274b44f22dc560fba0b39ad9))

## [2.1.2](https://github.com/zhinjs/zhin/compare/v2.1.1...v2.1.2) (2023-06-12)


### Bug Fixes

* 允许定义指令时，通过/定义父级指令 ([269ab97](https://github.com/zhinjs/zhin/commit/269ab974e658a889f9735e626f8a9ddf0c0bf0ee))
* 参数/选项类型判断错误 ([b32eeee](https://github.com/zhinjs/zhin/commit/b32eeeec1e5b3ef91effffb98c43d612c20c5078))
* 同步更改内置指令 ([3b2b26c](https://github.com/zhinjs/zhin/commit/3b2b26c6678c2f385fbb926a1fc74a372eb920ee))

## [2.1.1](https://github.com/zhinjs/zhin/compare/v2.1.0...v2.1.1) (2023-06-12)


### Bug Fixes

* baseType add user_id,set command action return string ([29dbfd7](https://github.com/zhinjs/zhin/commit/29dbfd75f21c16facec5464f78439a10a91d69ca))
* 默认指令写法更改 ([387582f](https://github.com/zhinjs/zhin/commit/387582fb5992fb20d80aff7071468a09e8443830))

## [2.1.0](https://github.com/zhinjs/zhin/compare/v2.0.7...v2.1.0) (2023-06-10)


### Features

* 重构command，破坏更新，请谨慎升级，与旧版command不兼容 ([8a2f644](https://github.com/zhinjs/zhin/commit/8a2f644a335053042a0a76d9c8de677d23f76fa4))

## [2.0.7](https://github.com/zhinjs/zhin/compare/v2.0.6...v2.0.7) (2023-05-06)


### Bug Fixes

* fake console ([c96b88a](https://github.com/zhinjs/zhin/commit/c96b88a3c59eaeb911a9a3f6f374cd2e75bb179b))

## [2.0.6](https://github.com/zhinjs/zhin/compare/v2.0.5...v2.0.6) (2023-05-06)


### Bug Fixes

* fake global ([dfa70e2](https://github.com/zhinjs/zhin/commit/dfa70e2c21e9d32c15df0bd7c98fb5960f2b763c))
* type error ([9557d14](https://github.com/zhinjs/zhin/commit/9557d14ba8639f2546ec84e14142edb1b9e4f397))

## [2.0.5](https://github.com/zhinjs/zhin/compare/v2.0.4...v2.0.5) (2023-05-06)


### Bug Fixes

* allow loop and when ([1313491](https://github.com/zhinjs/zhin/commit/1313491ad8f625a19a9a057ea08d731a8a73bbf6))
* element transform bug ([fb00359](https://github.com/zhinjs/zhin/commit/fb00359ff6c09ab7a43654578dc506b3629f6c49))
* 增加图片、语音、视频云端加载方案 ([1e2dd39](https://github.com/zhinjs/zhin/commit/1e2dd39e47b98225982cd901568369c930dec1c3))
* 日志优化 ([5a09713](https://github.com/zhinjs/zhin/commit/5a09713bda0782f35d1cbe0cb895cccd4307325b))
* 消息限速、文本超长自动转发 ([a1db268](https://github.com/zhinjs/zhin/commit/a1db26810c707946ed9d02b2c3308910d62cf2f7))
* 类型补充 ([5749c35](https://github.com/zhinjs/zhin/commit/5749c355732d9fbf8e2deb95cd7cd99378d36e9a))
* 系统保护 ([6a7f289](https://github.com/zhinjs/zhin/commit/6a7f28929948be128e3817b55ef766367c992705))

## [2.0.4](https://github.com/zhinjs/zhin/compare/v2.0.3...v2.0.4) (2023-04-04)


### Bug Fixes

* 将icqq 移入peerDependencies，并指定为最新版本(latest) ([d3eecdf](https://github.com/zhinjs/zhin/commit/d3eecdf39d76aa5840a007026fe26f3d53140c09))

## [2.0.3](https://github.com/zhinjs/zhin/compare/v2.0.2...v2.0.3) (2023-04-03)


### Bug Fixes

* 修复版本号错误 ([40531fd](https://github.com/zhinjs/zhin/commit/40531fd70a1709efbe083cb9a335efc9a2384ec6))

## [1.0.1](https://github.com/zhinjs/zhin/compare/v1.0.0...v1.0.1) (2023-04-03)


### Bug Fixes

* 适配器引用错误 ([aeb9459](https://github.com/zhinjs/zhin/commit/aeb9459493a6a64e8de54185d2d320a5c8ae0e3f))

## 1.0.0 (2023-04-03)


### Bug Fixes

* fix:  ([36df4f0](https://github.com/zhinjs/zhin/commit/36df4f009c1d9df140c5595acd5c8f960ba5c5bd))
