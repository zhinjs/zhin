import {
  CommandFeature,
  ComponentFeature,
  ConfigFeature,
  CronFeature,
  createMessageDispatcher,
  LoginAssist,
  MessageFilterFeature,
  PermissionFeature,
  SchemaFeature,
  type Message,
  type Plugin,
} from "zhin.js";

/** 与 packages/zhin/src/setup/register-core-services.ts 一致（不含 process 适配器） */
export function registerCoreServices(
  plugin: Plugin,
  appConfig: Record<string, unknown>,
  configFeature: ConfigFeature,
): void {
  const { provide } = plugin;
  provide(configFeature);

  const enabled = new Set(
    (appConfig.services as string[] | undefined) ?? [
      "config",
      "command",
      "component",
      "permission",
      "cron",
    ],
  );

  if (enabled.has("command")) provide(new CommandFeature());
  if (enabled.has("component")) provide(new ComponentFeature());
  if (enabled.has("permission")) provide(new PermissionFeature());
  if (enabled.has("cron")) provide(new CronFeature());

  const filterFeature = new MessageFilterFeature(
    appConfig.message_filter as ConstructorParameters<typeof MessageFilterFeature>[0],
  );
  provide(filterFeature);

  provide(createMessageDispatcher({
    dualRoute: appConfig.dispatcher as { mode?: "exclusive" | "dual" },
  }));

  plugin.useContext("dispatcher", (dispatcher) => {
    return dispatcher.addGuardrail(async (message: Message<object>, next) => {
      const result = filterFeature.test(message);
      if (result.allowed) await next();
    });
  });

  provide(new SchemaFeature());

  provide({
    name: "loginAssist",
    description: "登录辅助",
    mounted: async (p: Plugin) => new LoginAssist(p),
    dispose: async (s) => s.dispose(),
  });
}
