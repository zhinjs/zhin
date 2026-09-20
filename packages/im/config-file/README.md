# @zhin.js/config-file

Root Runtime 的 YAML/JSON `ConfigDocumentPort`。两种格式共享文件事务、revision 校验、原子替换和回滚生命周期；格式子类只负责解析与序列化。

## 模块边界

`@zhin.js/plugin-runtime` 定义配置文档端口和结构化 patch 语义；`@zhin.js/runtime` 只负责 schema 校验、影响范围规划和 generation handoff；`@zhin.js/config-file` 实现 Node 文件适配器：

- `ConfigFileDocument`：事务模板，封装 optimistic concurrency、commit 和 rollback。
- `YamlConfigDocument`：在 YAML AST 上应用 patch，保留注释、引号、anchor/alias、键顺序、缩进和换行风格。
- `JsonConfigDocument`：复用 Runtime 的 `applyConfigPatches`，稳定输出原文件的缩进和换行风格。
- `createConfigDocument(file)`：composition root 的格式选择入口。

## 使用

```ts
import { createConfigDocument } from '@zhin.js/config-file';
import { RootRuntime } from '@zhin.js/runtime';

const runtime = new RootRuntime({
  projectRoot: process.cwd(),
  modules,
  environment: { name: 'production', mode: 'production', platform: 'node' },
  config: createConfigDocument('config.json'),
});

await runtime.start();
await runtime.patchConfig([{
  op: 'set',
  path: ['plugins', 'reports', 'retries'],
  value: 5,
}]);
```

Root 先用组合后的 JSON Schema 校验候选文档，再执行受影响 Plugin forest 的 shadow setup。两步都成功后，文件事务才作为 generation handoff participant 提交；后续 participant 失败时，文件事务恢复原始字节。

## 文档事务

`read()` 返回文档和值对应的 SHA-256 revision。`readSource()` 在同一快照中额外返回原始文本和格式。`prepare()` 只构造结构化 patch 的候选内容，`prepareReplacement(expectedRevision, source)` 则校验并准备一次保留原始字节的全文替换。两者都不提前写文件；`commit()` 再次核对 revision，然后通过同目录临时文件和原子 rename 落盘。`rollback()` 同样核对当前 revision，防止覆盖事务之外的编辑。

同一进程内的 Root Runtime、Endpoint 配置命令和 Console 应共享 composition root 创建的同一个 `ConfigFileDocument`。调用方可以各自串行化业务操作；跨调用方竞争由 revision 冲突显式拒绝，不允许任何模块重新发现配置文件或直接覆盖磁盘。

- `ConfigDocumentParseError`：配置无法解析或根节点不是对象。
- `ConfigDocumentConflictError`：read、prepare、commit 或 rollback 之间文件被其他写入者修改。
- `ConfigPatchPathError`：删除文档根、数组路径无效或路径包含不安全字段。

环境变量表达式作为普通字符串保留。环境 overlay 和 secret 解析属于 Root Resource，不由文件适配器展开。

## 开发验证

```bash
pnpm --filter @zhin.js/config-file test
pnpm --filter @zhin.js/config-file build
pnpm --filter @zhin.js/config-file check:size
```

## 相关文档

- [Plugin Runtime](../runtime/README.md)
- [Config、Discovery 与 HMR](../../../docs/architecture/target-implementation/config-discovery-hmr.md)
- [Config as Data](../../../docs/concepts/config-as-data.md)
