import { describe, expect, it } from "vitest";
import { timingSafeEqualString } from "../src/timing-safe-equal.js";

describe("timingSafeEqualString", () => {
  it("matches equal strings", () => {
    expect(timingSafeEqualString("abc", "abc")).toBe(true);
  });

  it("rejects different strings", () => {
    expect(timingSafeEqualString("abc", "abd")).toBe(false);
    expect(timingSafeEqualString("a", "ab")).toBe(false);
  });
});
