# 完整来源身份与原生文本回复

此文件由 Console 生成，尚未证明你的插件通过测试。scenario.json 中的 preview 是作者预期外观；assertions 是作者单独填写的最终派发/投递断言。

## 显式运行

准备独立、可信的测试项目及它实际需要的依赖和插件，安装开发依赖 @zhin.js/testing、@zhin.js/plugin-runtime、@zhin.js/adapter 与 tsx；导出不会自动安装或运行。将这三个文件放进该测试项目中，再执行：

ZHIN_SCENARIO_FIXTURE_ROOT=/absolute/path/to/test-app node --conditions=development --import tsx --test scenario.test.mjs

必须显式提供绝对路径，无 cwd 或生产配置回退。测试配置来自 scenario.fixture.config，账号 {"id":"root/source\u0000zhin.adapter\u0000example","adapter":"example"} 显式映射为合成别名 "scenario"；kind/id/parent/thread 和发送者完整保留。首版断言所有最终投递均指向该原会话的合成账号映射，跨会话主动发送应另写测试。

PluginTestKit 运行真实模块 import/setup/指令/中间件并记录合成端点最终载荷；它不是安全沙箱。独立数据目录与无凭据配置不能阻止代码访问宿主文件或联网。只运行可信 fixture，勿挂载真实适配器、生产配置、数据库或凭据；不要在生产 Host 运行此文件。limited 断言需要支持该准入状态的 Runtime。角色是测试假设，非平台权限证明；HTML direct/native 仅表示测试能力，不证明真实平台外观或投递。

## 证据边界

导出 ≠ 执行通过；合成端点 Runtime 回归 ≠ 浏览器截图 ≠ 真实平台发送。检查失败时核对明确断言，不要自动重放生产消息。
