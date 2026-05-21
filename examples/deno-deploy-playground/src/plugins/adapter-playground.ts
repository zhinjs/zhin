import { usePlugin } from "zhin.js";
import { PlaygroundWsAdapter } from "../adapter/playground-ws.ts";

const { provide } = usePlugin();

provide({
  name: "playground",
  description: "Deno Deploy WebSocket 适配器（Zhin 真实 Adapter.emit → dispatch）",
  mounted: async (p) => {
    const adapter = new PlaygroundWsAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: PlaygroundWsAdapter) => {
    for (const bot of adapter.bots.values()) {
      await bot.$disconnect();
    }
    await adapter.stop();
  },
});
