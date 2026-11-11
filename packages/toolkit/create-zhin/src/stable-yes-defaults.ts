import type { InitOptions } from '@zhin.js/scaffold-wizard';

/**
 * create-zhin 默认值（ADR 0053 §1）：交互与 `-y` 相同，只生成 IM 核心 + Console Host 的最小项目。
 *
 * 只填补未由命令行参数指定的项；数据库、适配器、AI 保持未设置，
 * 交给 Console 引导（数据库未配置时 Runtime 使用默认 SQLite `.zhin/data.sqlite`）。
 */
export function applyCreateDefaults(options: InitOptions): void {
  options.template ??= 'default';
  options.config ??= 'yaml';
  options.devSkills ??= false;
}
