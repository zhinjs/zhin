import type { DeclaredPluginReference } from '../plugin-lifecycle-store.js';

/** An instance key wins over a package alias; package aliases must be unique. */
export function resolveDiagnosticPlugin(
  requested: string,
  declared: readonly DeclaredPluginReference[],
): DeclaredPluginReference {
  const instance = declared.find(item => item.instanceKey === requested);
  if (instance) return instance;
  const packages = declared.filter(item => item.packageName === requested);
  if (packages.length === 1) return packages[0]!;
  if (packages.length > 1) throw new Error('此包存在多个插件实例，请使用精确实例名进行诊断');
  throw new Error('未找到已声明的插件实例');
}
