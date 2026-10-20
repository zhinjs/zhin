import { describe, expect, it } from "vitest";
import {
  joinConsolePublicPath,
  rewriteBareImportsForBrowser,
} from "./esmForBrowser.js";

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

describe("rewriteBareImportsForBrowser", () => {
  it("rewrites react/jsx-runtime bare imports to /esm/*.mjs", () => {
    const input = 'import { jsx as _jsx } from "react/jsx-runtime";\nexport default function A() { return _jsx("div", {}); }\n';
    const out = rewriteBareImportsForBrowser(input, "/", "");
    expect(out).toMatch(/from "\/esm\/react~jsx-runtime\.mjs\?v=/);
    expect(out).not.toMatch(/from "react\/jsx-runtime"/);
  });

  it("rewrites react and react-dom bare imports", () => {
    const input = [
      'import * as React from "react";',
      'import { createRoot } from "react-dom/client";',
      'export { React, createRoot };',
    ].join("\n");
    const out = rewriteBareImportsForBrowser(input, "/", "");
    expect(out).toMatch(/from "\/esm\/react\.mjs\?v=/);
    expect(out).toMatch(/from "\/esm\/react-dom~client\.mjs\?v=/);
  });
});
