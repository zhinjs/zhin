import { describe, expect, it } from "vitest";
import { assertConsoleRpcAllowed } from "../src/rpc/parity.js";

describe("Console parity matrix", () => {
  it("allows host-only types on host", () => {
    expect(assertConsoleRpcAllowed("db:info", "host")).toBeNull();
    expect(assertConsoleRpcAllowed("bot:friends", "host")).toBeNull();
  });

  it("blocks IM social types on edge", () => {
    expect(assertConsoleRpcAllowed("bot:inboxMessages", "edge")).toContain("Edge");
  });

  it("allows edge subset", () => {
    expect(assertConsoleRpcAllowed("config:get", "edge")).toBeNull();
    expect(assertConsoleRpcAllowed("bot:list", "edge")).toBeNull();
    expect(assertConsoleRpcAllowed("cron:list", "edge")).toBeNull();
    expect(assertConsoleRpcAllowed("files:tree", "edge")).toBeNull();
    expect(assertConsoleRpcAllowed("files:read", "edge")).toBeNull();
    expect(assertConsoleRpcAllowed("db:tables", "edge")).toBeNull();
    expect(assertConsoleRpcAllowed("db:info", "edge")).toBeNull();
  });
});
