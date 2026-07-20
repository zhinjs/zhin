import { usePlugin, MessageCommand } from "zhin.js";

// Minimal legacy-plugin fixture for plugin-inspection tests
// (was previously borrowed from examples/test-bot/src/plugins/, removed with
// the legacy CLI path).
const { addCommand } = usePlugin();

addCommand(
  new MessageCommand("fixture-ping").desc("fixture command").action(() => "pong"),
);
