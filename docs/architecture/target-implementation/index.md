# 目标架构蓝图总览

本目录是 Plugin Runtime 目标架构的实现蓝图与迁移档案。架构不变量与总体设计见 [TARGET-ARCHITECTURE](/target-architecture)。

## 实现蓝图

- [Config、Discovery 与 HMR](./config-discovery-hmr.md) — 配置文档、包发现与 HMR 设计
- [IM、Agent 与 Console Runtime](./domain-runtimes.md) — 三个领域 Runtime 的职责划分
- [Plugin Runtime 实现状态](./greenfield-bootstrap.md) — Greenfield 搭建顺序与当前进度
- [Kernel 与原子 Generation](./kernel-and-generation.md) — generation transaction 的底层语义
- [Plugin Monorepo 与 Feature Provider](./plugin-monorepo-and-features.md) — 包组织与 Feature provider 契约

## 迁移档案

- [Plugin Runtime 原位迁移](./in-place-migration.md) — replace-in-place 迁移进度与最终 ownership（持续更新）
- [Plugin Runtime 迁移契约](./migration-contract.md) — 迁移的兼容契约
- [migration-topology.json](./migration-topology.json) — 机器可读迁移拓扑（`pending` 必须为空）
