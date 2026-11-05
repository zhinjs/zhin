import { describe, expect, it } from "vitest";
import {
  getOrBuildCanonicalEsmBundle,
  joinConsolePublicPath,
  KNOWN_NAMED_EXPORTS,
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

describe("KNOWN_NAMED_EXPORTS and getOrBuildCanonicalEsmBundle", () => {
  it("includes React 19, react-dom, react-dom/client, and react-router exports", () => {
    expect(KNOWN_NAMED_EXPORTS.react).toEqual(
      expect.arrayContaining([
        "use",
        "useActionState",
        "useOptimistic",
        "useSyncExternalStore",
        "useTransition",
        "cache",
        "act",
      ]),
    );
    expect(KNOWN_NAMED_EXPORTS["react-dom"]).toEqual(
      expect.arrayContaining(["createPortal", "flushSync", "useFormStatus"]),
    );
    expect(KNOWN_NAMED_EXPORTS["react-dom/client"]).toEqual(
      expect.arrayContaining(["createRoot", "hydrateRoot"]),
    );
    expect(KNOWN_NAMED_EXPORTS["react-router-dom"]).toEqual(
      expect.arrayContaining(["useLocation", "useNavigate", "useParams", "Link", "Routes", "Route"]),
    );
  });

  it("builds a self-fallback ESM bundle for react and react-router-dom", async () => {
    const reactCode = await getOrBuildCanonicalEsmBundle("react", process.cwd(), "/");
    expect(reactCode).toContain("export const useState");
    expect(reactCode).toContain("export const useSyncExternalStore");
    expect(reactCode).toContain("_loadLocalFallback");

    const routerCode = await getOrBuildCanonicalEsmBundle("react-router-dom", process.cwd(), "/");
    expect(routerCode).toContain("export const useNavigate");
    expect(routerCode).toContain("export const Link");
  });
});
