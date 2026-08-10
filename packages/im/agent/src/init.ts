/**
 * @deprecated **已删除**。Legacy `bootstrapNode` 路径已移除；
 * Plugin Runtime (`zhin runtime start`) 通过 basic/cli 自行装配 Agent。
 * @throws 总是抛出。
 */
export function initAgentModule(): never {
  throw new Error(
    'initAgentModule() has been removed. '
    + 'The Plugin Runtime assembles the Agent stack via basic/cli. '
    + 'See docs/contributing/public-api-surface.md',
  );
}
