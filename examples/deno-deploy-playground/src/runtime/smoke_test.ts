import { assertEquals } from "jsr:@std/assert@1.0.19";
import { MessageCommand } from "zhin.js";

Deno.test("MessageCommand 与仓库 API 一致", () => {
  const cmd = new MessageCommand("ping");
  assertEquals(cmd.pattern, "ping");
});
