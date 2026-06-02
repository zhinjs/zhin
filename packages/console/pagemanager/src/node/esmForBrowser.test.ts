import { describe, expect, it } from "vitest";
import { joinConsolePublicPath } from "./esmForBrowser.js";

describe("joinConsolePublicPath", () => {
  it("avoids protocol-relative //esm when base is /", () => {
    expect(joinConsolePublicPath("/", "esm/react.mjs")).toBe("/esm/react.mjs");
    expect(joinConsolePublicPath("", "esm/react.mjs")).toBe("/esm/react.mjs");
  });

  it("prefixes subpath under /console", () => {
    expect(joinConsolePublicPath("/console", "esm/react.mjs")).toBe(
      "/console/esm/react.mjs",
    );
    expect(joinConsolePublicPath("/console", "@dev/foo.mjs")).toBe(
      "/console/@dev/foo.mjs",
    );
  });
});
