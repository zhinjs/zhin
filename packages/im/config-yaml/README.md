# @zhin.js/config-yaml

下一代 Runtime 的可选 YAML `ConfigDocumentPort`。它在 YAML AST 上应用结构化 patch，保留未触及节点的注释、引号、anchor/alias、`${ENV}` 字符串、键顺序、缩进和换行风格，并通过同目录临时文件加原子 rename 持久化。

> 当前包属于 `feature/next` 绿地实现，版本仍为 `0.0.0` 且未作为稳定 API 发布。

## 为什么独立成包

`@zhin.js/runtime` 只定义 `ConfigDocumentPort`，默认生产闭包不包含 YAML parser。需要 `config.yml` 的 Root 单独安装本包；只使用内存配置或其他配置存储时无需承担这项依赖。

本包只增加 `yaml@2.9.0`，不依赖 Vite、编译器、CSS 工具或 native/wasm 模块。包含 Runtime 的完整生产安装仍受 5MB 门禁约束。

## 使用

```ts
import { YamlConfigDocument } from '@zhin.js/config-yaml';
import { RootRuntime } from '@zhin.js/runtime';

const runtime = new RootRuntime({
  projectRoot: process.cwd(),
  modules,
  environment: { name: 'production', mode: 'production', platform: 'node' },
  config: new YamlConfigDocument('config.yml'),
});

await runtime.start();
await runtime.patchConfig([{
  op: 'set',
  path: ['plugins', 'reports', 'retries'],
  value: 5,
}]);
```

Root 先用组合后的 JSON Schema 校验候选文档，再执行受影响 Plugin forest 的 shadow setup。只有两步都成功，YAML transaction 才作为 generation handoff 的最后一个 participant 提交；CAS 前失败会恢复原始文件并撤销新 generation Resource。

## 文档事务

`read()` 返回原始对象和基于文件字节的 SHA-256 revision。`prepare()` 只构造候选 AST，不写文件。`commit()` 在写入前再次检查 revision，随后使用同目录临时文件和原子 rename；`rollback()` 也先确认文件仍是本事务写入的 revision，避免覆盖外部编辑。

以下情况抛出明确错误：

- `ConfigDocumentParseError`：YAML 无法解析，或根节点不是 mapping。
- `ConfigDocumentConflictError`：read/prepare/commit/rollback 之间文件被其他写入者修改。
- `ConfigPatchPathError`：删除文档根或使用 `__proto__` 等不安全路径。

环境变量表达式目前按普通字符串保留。环境 overlay 和 secret 解析属于独立 Root Resource，不由 YAML adapter 隐式展开。

## 保真边界

未触及 AST 节点会保留 comment、scalar style、anchor/alias 与顺序。被替换 scalar 沿用 `yaml` AST 节点已有的样式；新增节点使用 `yaml` 的稳定默认输出。整个文档沿用原文件检测到的缩进宽度与 LF/CRLF 风格。

原子 rename 防止读取到半写文件，但不替代跨主机分布式锁。多个进程写同一文件时，revision 冲突会拒绝后写者，调用方应重新读取后再规划 patch。

## 开发验证

```bash
pnpm --filter @zhin.js/config-yaml test
pnpm --filter @zhin.js/config-yaml build
pnpm --filter @zhin.js/config-yaml check:size
```

## 相关文档

- [Plugin Runtime](../runtime/README.md)
- [Config、Discovery 与 HMR](../../../docs/architecture/target-implementation/config-discovery-hmr.md)
- [Greenfield Bootstrap 状态](../../../docs/architecture/target-implementation/greenfield-bootstrap.md)
