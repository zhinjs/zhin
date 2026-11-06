import { projectLocaleToken } from 'zhin.js/i18n';
import {
  databaseHostToken,
  definePlugin,
  definePluginCapabilityGraph,
  outboundHostToken,
  pluginConsoleRpcToken,
  type DeliveryTarget,
} from "zhin.js";
import { httpHostToken } from "@zhin.js/host-http";
import {
  assertCalendarTimezone,
  type CalendarConfig,
  createCalendarConsoleRpc,
  createCalendarProvider,
  createOAuthTokenManagers,
} from "./src/index.js";
import {
  buildRedirectUri,
  CalendarAuthService,
  DEFAULT_OAUTH_CALLBACK_PATH,
  localOriginFromAddress,
  type CalendarNotifier,
} from "./src/chat-auth.js";
import {
  CalendarCredentialStore,
  type CalendarStateStore,
} from "./src/credential-store.js";
import { registerOAuthCallbackRoute } from "./src/http-callback.js";
import { calendarRuntimeStore } from "./src/runtime.js";

export default definePlugin<CalendarConfig>({
  name: "calendar",
  metadata: { displayName: "日历" },
  capabilityGraph: definePluginCapabilityGraph({
    provides: [calendarRuntimeStore, pluginConsoleRpcToken],
    injects: [databaseHostToken, outboundHostToken, httpHostToken, projectLocaleToken],
    features: {
      commands: ["calendar/auth", "calendar/logout", "calendar/status"],
      skills: ["calendar-scheduling"],
      tools: ["create_event", "find_free_time", "list_events"],
      pages: ["index"],
    },
  }),
  setup(context) {
    const config = context.config.get();
    assertCalendarTimezone(config.timezone);

    const resources = context.resources;
    const credentials = resources.has(databaseHostToken)
      ? new CalendarCredentialStore(
          resources.use(databaseHostToken)
            .state as unknown as CalendarStateStore
        )
      : undefined;
    const outbound = resources.has(outboundHostToken)
      ? resources.use(outboundHostToken)
      : undefined;
    const http = resources.has(httpHostToken)
      ? resources.use(httpHostToken)
      : undefined;

    const notify: CalendarNotifier<DeliveryTarget> | undefined =
      outbound?.sendTarget
        ? async (target, text, locale) => {
            await outbound.sendTarget!(target, text, { locale });
          }
        : undefined;

    const callbackPath =
      config.oauth_callback_path?.trim() || DEFAULT_OAUTH_CALLBACK_PATH;
    const resolveRedirectUri = (): string | undefined => {
      const configuredBase = config.oauth_redirect_base_url?.trim() ?? "";
      if (configuredBase) {
        return buildRedirectUri(configuredBase, callbackPath);
      }
      const address = http?.address;
      if (!address) {
        return undefined;
      }
      return buildRedirectUri(localOriginFromAddress(address), callbackPath);
    };

    const managers = createOAuthTokenManagers(config, {
      credentials,
      onAuthorizationLost: (provider, message) =>
        auth.notifyAuthorizationLost(provider, message),
    });
    const auth = new CalendarAuthService<DeliveryTarget>({
      config,
      locale: resources.use(projectLocaleToken),
      managers,
      credentials,
      notify,
      resolveRedirectUri,
    });

    const provider = createCalendarProvider(config, { managers });
    const runtime = {
      config,
      provider,
      auth: auth as CalendarAuthService<unknown>,
    };
    calendarRuntimeStore.provide(context, runtime);
    if (config.provider !== "none" && !provider) {
      console.warn(
        "[calendar] provider 已配置但凭据为空，日历工具将不可用；Google/Microsoft 请先配置 client_id，再在聊天中发送 calendar auth <provider>"
      );
    }

    const releaseRoute = http
      ? registerOAuthCallbackRoute(http, callbackPath, (searchParams) =>
          auth.handleCallback(searchParams)
        )
      : undefined;
    return {
      consoleRpc: createCalendarConsoleRpc(runtime),
      dispose: () => {
        releaseRoute?.();
      },
    };
  },
});
