import { Command } from "commander";
import { logger } from "../utils/logger.js";
import fs from "fs-extra";
import path from "path";
import {
  performSmartBuild,
  shouldUseSmartBuildInCwd,
  printEmptyPluginDirsError,
  watchClientBundle,
} from "../libs/plugin-package-build.js";

export const buildCommand = new Command("build")
  .description("构建插件：按目录自动编译 src（tsc）与 client（esbuild）；也可在 zhin workspace 下批量构建 plugins/*")
  .argument("[plugin]", "插件路径（相对 plugins/，如 adapters/icqq）；省略时在智能目录下构建当前包，或在 workspace 根构建全部插件")
  .option("--clean", "清理 lib/ 与 dist/ 后再构建", false)
  .option("--production", "生产构建（client 压缩）", true)
  .option("--analyze", "（预留）分析包体积", false)
  .option(
    "--watch",
    "仅监听 client/ 增量写入 dist（需存在 client；不支持批量构建）",
    false,
  )
  .action(
    async (
      pluginName: string | undefined,
      options: {
        clean: boolean;
        production: boolean;
        analyze: boolean;
        watch: boolean;
      },
    ) => {
      try {
        const cwd = process.cwd();

        if (options.watch) {
          if (pluginName) {
            logger.error("--watch 不能与 [plugin] 参数同时使用");
            process.exit(1);
          }
          if (!shouldUseSmartBuildInCwd(cwd)) {
            logger.error(
              "--watch 仅适用于插件包或带 client 的 zhin 应用根目录（需含 plugin.yml、zhin.js-* 包名或 zhin.js 依赖 + src + client）",
            );
            process.exit(1);
          }
          if (!fs.existsSync(path.join(cwd, "client"))) {
            logger.error("--watch 需要存在 client/ 目录");
            process.exit(1);
          }
          logger.info("zhin build --watch：监听 client/ …（Ctrl+C 退出）");
          await watchClientBundle(cwd);
          return;
        }

        if (!pluginName && shouldUseSmartBuildInCwd(cwd)) {
          let label = path.basename(cwd);
          try {
            const pkg = (await fs.readJson(
              path.join(cwd, "package.json"),
            )) as { name?: string };
            if (pkg.name) label = pkg.name;
          } catch {
            /* keep basename */
          }
          logger.info(`智能构建: ${label}（当前目录）`);
          await performSmartBuild(cwd, String(label), {
            clean: options.clean,
            production: options.production,
          });
          logger.success(`${label} 构建完成`);
          return;
        }

        if (!isWorkspaceProject(cwd)) {
          logger.error(
            "当前目录不是 Zhin workspace 根（需存在 pnpm-workspace.yaml，且 package.json 的 dependencies / devDependencies / peerDependencies 之一声明 zhin.js），且也不满足插件/应用智能构建条件。",
          );
          logger.log(
            "若要在 monorepo 根执行 zhin build：请在根 package.json 声明 zhin.js。若你在开发独立插件：请在插件根目录执行，并确保存在 plugin.yml 或包名为 zhin.js-* / @zhin.js/adapter-* 等。",
          );
          process.exit(1);
        }

        const pluginsDir = path.join(cwd, "plugins");

        if (!fs.existsSync(pluginsDir)) {
          logger.error("未找到 plugins 目录");
          process.exit(1);
        }

        if (pluginName) {
          const pluginPath = path.join(pluginsDir, pluginName);

          if (!fs.existsSync(pluginPath)) {
            logger.error(`未找到插件: ${pluginName}`);
            process.exit(1);
          }

          await buildOnePluginPath(pluginPath, pluginName, options);
        } else {
          const plugins = await fs.readdir(pluginsDir);
          const validPlugins = plugins.filter((p) => {
            const pluginPath = path.join(pluginsDir, p);
            const stat = fs.statSync(pluginPath);
            return (
              stat.isDirectory() &&
              fs.existsSync(path.join(pluginPath, "package.json"))
            );
          });

          if (validPlugins.length === 0) {
            logger.warn("未找到任何插件");
            return;
          }

          logger.info(`找到 ${validPlugins.length} 个插件，开始构建...`);

          for (const plugin of validPlugins) {
            const pluginPath = path.join(pluginsDir, plugin);
            await buildOnePluginPath(pluginPath, plugin, options);
          }
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "empty plugin dirs"
        ) {
          process.exit(1);
        }
        logger.error(`构建失败: ${error}`);
        process.exit(1);
      }
    },
  );

async function buildOnePluginPath(
  pluginPath: string,
  pluginName: string,
  options: { clean: boolean; production: boolean; analyze: boolean },
): Promise<void> {
  logger.info(`正在构建插件: ${pluginName}...`);

  const hasSrc = fs.existsSync(path.join(pluginPath, "src"));
  const hasClient = fs.existsSync(path.join(pluginPath, "client"));

  if (!hasSrc && !hasClient) {
    printEmptyPluginDirsError(pluginName);
    throw new Error("empty plugin dirs");
  }

  if (options.production) {
    logger.info(`📦 生产构建模式`);
  }

  try {
    await performSmartBuild(pluginPath, pluginName, {
      clean: options.clean,
      production: options.production,
    });
  } catch (e) {
    logger.error(`✗ ${pluginName} 构建失败: ${e}`);
    throw e;
  }

  logger.success(`${pluginName} 构建完成`);
}

function isWorkspaceProject(dir: string): boolean {
  const workspaceYamlPath = path.join(dir, "pnpm-workspace.yaml");
  const packageJsonPath = path.join(dir, "package.json");

  if (!fs.existsSync(workspaceYamlPath) || !fs.existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const packageJson = fs.readJsonSync(packageJsonPath) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    return Boolean(
      packageJson.dependencies?.["zhin.js"] ||
        packageJson.devDependencies?.["zhin.js"] ||
        packageJson.peerDependencies?.["zhin.js"],
    );
  } catch {
    return false;
  }
}
