/**
 * 注册 home_* 工具（assistant.home.enabled 时）
 */
import { formatCompact, getPlugin } from '@zhin.js/core';
import { resolveAssistantHomeConfig, isAssistantHomeActive } from '../assistant/home-config.js';
import { HomeAssistantService } from '../assistant/domains/home-assistant.js';
import { createHomeTools } from '../assistant/home-tools.js';
import { mergeProfileDeviceAliases, loadAssistantProfileFile } from '../assistant/profile-loader.js';
import { validateHomeMcpServer } from '../assistant/home-mcp-bridge.js';
import type { AssistantConfig } from '../assistant/config.js';
import type { AIConfig } from '@zhin.js/ai';

export function registerHomeTools(): void {
  const plugin = getPlugin();
  const { useContext, root, logger } = plugin;

  useContext('ai', 'tool', (_ai, toolService) => {
    if (!toolService) return;

    void (async () => {
      const configService = root.inject('config');
      const appConfig = (configService?.primaryFile
        ? configService.getRaw<{ assistant?: AssistantConfig; ai?: AIConfig }>(configService.primaryFile)
        : configService?.getPrimary<{ assistant?: AssistantConfig; ai?: AIConfig }>())
        ?? {};
      const homeRaw = appConfig.assistant?.home;
      if (!isAssistantHomeActive(homeRaw)) return;

      const profile = await loadAssistantProfileFile(process.cwd(), appConfig.assistant?.profile);
      const homeCfg = resolveAssistantHomeConfig({
        ...homeRaw,
        aliases: mergeProfileDeviceAliases(profile, homeRaw?.aliases),
      });
      const mcpWarn = validateHomeMcpServer(homeCfg, appConfig.ai);
      if (mcpWarn) logger.warn(formatCompact({ assistant_home_mcp: mcpWarn }));

      const service = new HomeAssistantService(homeCfg);
      const tools = createHomeTools({ service, policy: homeCfg.policy });
      const disposers: (() => void)[] = [];
      for (const tool of tools) {
        disposers.push(toolService.addTool(tool.toTool(), root.name));
      }
      logger.info(formatCompact({
        assistant_home: true,
        aliases: Object.keys(homeCfg.aliases ?? {}).length,
        mcpServer: homeCfg.mcpServer,
      }));

      plugin.on('dispose', () => {
        for (const d of disposers) d();
      });
    })();
  });
}
