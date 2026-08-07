/**
 * Init 向导 guardrail — 所有 bot 入站时 stash observation（不依赖 AI 触发）。
 *
 * 收集阶段：各 bot 写 init_observations；仅 Planner 回复下一步 prompt。
 * 提交阶段仍由 /collab inited 命令一次性创建 Cell。
 */
import { getPlugin, type Message } from '@zhin.js/core';
import { formatCompact } from '@zhin.js/logger';
import { handleInitWizardInboundGate } from '../collaboration/init-observe-hook.js';

export function registerInitWizardGuardrail(): void {
  const plugin = getPlugin();
  const { root, logger } = plugin;

  plugin.useContext('dispatcher', (dispatcher) => {
    if (!dispatcher?.addGuardrail) return;

    const dispose = dispatcher.addGuardrail(async (message: Message, next) => {
      const scope = message.$channel?.type;
      if (scope !== 'group' && scope !== 'channel') {
        await next();
        return;
      }

      try {
        const endpointId = String(message.$endpoint ?? '');
        const gate = await handleInitWizardInboundGate(message, endpointId, root);
        if (gate.action === 'block') {
          if (gate.replied) {
            logger.info(formatCompact({ op: 'init_wizard_prompt', endpoint: endpointId }));
          }
          return;
        }
      } catch (err) {
        logger.debug(formatCompact({ op: 'init_wizard_error', error: err instanceof Error ? err.message : String(err) }));
      }

      await next();
    });

    logger.debug('Init wizard guardrail enabled');
    return dispose;
  });
}
