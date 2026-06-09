import { describe, it, expect } from "vitest";
import { normalizeGroupAtPrefix } from "../src/group-at-normalize.js";

const BOT_ID = "15535836398022916909";

describe("normalizeGroupAtPrefix", () => {
  it("leading at + /cmd：正文在前，at 在末尾", () => {
    const out = normalizeGroupAtPrefix(
      [
        { type: "at", data: { qq: BOT_ID, id: BOT_ID } },
        { type: "text", data: { text: "/cmd" } },
      ],
      [BOT_ID],
      true,
    );
    expect(out).toEqual([
      { type: "text", data: { text: "/cmd" } },
      { type: "at", data: { qq: BOT_ID, id: BOT_ID } },
    ]);
  });

  it("内联 @/cmd：剥掉内联 @，末尾补规范 at", () => {
    const out = normalizeGroupAtPrefix(
      [{ type: "text", data: { text: `@${BOT_ID}/cmd` } }],
      [BOT_ID],
      true,
    );
    expect(out).toEqual([
      { type: "text", data: { text: "/cmd" } },
      { type: "at", data: { qq: BOT_ID, id: BOT_ID } },
    ]);
  });

  it("GROUP_AT 事件无 at 段：末尾补规范 at", () => {
    const out = normalizeGroupAtPrefix(
      [{ type: "text", data: { text: "你好" } }],
      [BOT_ID],
      true,
    );
    expect(out).toEqual([
      { type: "text", data: { text: "你好" } },
      { type: "at", data: { qq: BOT_ID, id: BOT_ID } },
    ]);
  });
});
