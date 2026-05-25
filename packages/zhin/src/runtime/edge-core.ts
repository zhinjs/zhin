import { setLevel } from '@zhin.js/logger';
import type { SandboxWsHostAdapter } from '@zhin.js/adapter-sandbox';
import { applyEdgeDatabase } from './apply-edge-database.js';
import { createEdgeHttpApp, type CreateEdgeHttpAppOptions } from './edge-http.js';
import { registerEdgeCoreServices } from './edge-core-services.js';
import { REMOTE_CONSOLE_ORIGIN, resolveEdgeConfig, resolveHttpConfig } from './http-config.js';
import { loadEdgePlugins, type LoadEdgePluginsOptions } from './load-edge-plugins.js';
import { DEFAULT_EDGE_APP_CONFIG } from '../setup/load-config.js';
import { prepareRuntime } from './shared.js';
import type { BootstrapEdgeResult, BootstrapOptions } from './types.js';

export type BootstrapEdgeOptions = BootstrapOptions & {
  loadPlugins?: LoadEdgePluginsOptions;
  /** Console 静态资源路由（/entries、/@assets 等） */
  registerAssetRoutes?: CreateEdgeHttpAppOptions['registerAssetRoutes'];
  getConsoleEntriesRecord: () => Record<string, string>;
};

/**
 * Edge 运行时：Fetch HTTP + Console 子集 + Sandbox（SSE 或 WS），无 IM connectBots。
 */
export async function bootstrapEdgeCore(
  options: BootstrapEdgeOptions,
): Promise<BootstrapEdgeResult> {
  const prepared = await prepareRuntime({
    projectRoot: options.projectRoot,
    autoStart: false,
    configDefaults: DEFAULT_EDGE_APP_CONFIG,
    registerCore: registerEdgeCoreServices,
    applyDatabase: (plugin, appConfig) => {
      applyEdgeDatabase(plugin, appConfig);
    },
    loadPluginsFn: (plugin, appConfig) =>
      loadEdgePlugins(plugin, appConfig, {
        projectRoot: options.projectRoot,
        ...options.loadPlugins,
      }),
    afterPluginsLoaded: options.afterPluginsLoaded,
  });

  const { plugin, appConfig, configPath } = prepared;

  if (appConfig.log_level != null) {
    setLevel(appConfig.log_level);
  }

  await plugin.start();

  const sandbox = plugin.inject('sandbox') as SandboxWsHostAdapter | undefined;
  if (!sandbox) {
    throw new Error(
      'adapter-sandbox 未注册：请在 zhin.config 的 plugins 中包含 adapter-sandbox',
    );
  }

  const http = resolveHttpConfig(appConfig);
  const edge = resolveEdgeConfig(appConfig);

  const fetchApp = createEdgeHttpApp({
    plugin,
    http,
    edge,
    getSandboxAdapter: () => sandbox,
    getConsoleEntriesRecord: options.getConsoleEntriesRecord,
    registerAssetRoutes: options.registerAssetRoutes,
    configPath,
  });

  const publicHost =
    http.host === '0.0.0.0' || http.host === '::' ? '127.0.0.1' : http.host;
  const apiBaseUrl = `http://${publicHost}:${http.port}`;
  const consoleDeepLink = `${REMOTE_CONSOLE_ORIGIN}/?apiBaseUrl=${encodeURIComponent(apiBaseUrl)}`;
  plugin.logger.info(
    `edge listen: port=${http.port} api=${apiBaseUrl}${http.base} openapi=${apiBaseUrl}/pub/openapi.json sandbox_ui=${apiBaseUrl}/sandbox-ui console=${consoleDeepLink}${http.token ? ` token_prefix=${http.token.slice(0, 6)}` : ''}`,
  );
  plugin.logger.info(
    '提示: https://console.zhin.dev 无法请求 http://127.0.0.1 API（浏览器混合内容）；本地沙盒请打开 sandbox_ui，远程 Console 需 HTTPS API（隧道）或 Deploy 域名',
  );
  plugin.logger.info(
    `config: ${configPath}; sandbox: ${sandbox.transport}; plugins: ${plugin.children.length}`,
  );

  return {
    ...prepared,
    http,
    edge,
    fetch: fetchApp.fetch,
    getSandboxAdapter: () => sandbox,
  };
}
