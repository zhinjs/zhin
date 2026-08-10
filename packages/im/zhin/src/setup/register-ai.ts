/**
 * @deprecated **已删除**。Legacy `bootstrapNode` 路径已移除；
 * Plugin Runtime (`zhin runtime start`) 通过 basic/cli 装配 Agent。
 */
export async function registerAI(): Promise<void> {
  throw new Error(
    'registerAI() has been removed. '
    + 'The Plugin Runtime assembles the Agent stack via basic/cli.',
  );
}
