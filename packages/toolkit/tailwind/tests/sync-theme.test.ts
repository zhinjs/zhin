import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("bundled theme synchronization", () => {
  it("accepts Windows line endings while rejecting stale theme content", () => {
    const root = mkdtempSync(join(tmpdir(), "zhin-theme-"));
    try {
      mkdirSync(join(root, "scripts"));
      mkdirSync(join(root, "src"));
      mkdirSync(join(root, "node_modules/tailwindcss"), { recursive: true });
      copyFileSync(
        new URL("../scripts/sync-theme.mjs", import.meta.url),
        join(root, "scripts/sync-theme.mjs")
      );
      writeFileSync(
        join(root, "node_modules/tailwindcss/package.json"),
        JSON.stringify({ name: "tailwindcss", version: "4.9.0" })
      );
      const theme = join(root, "node_modules/tailwindcss/theme.css");
      const output = join(root, "src/default-theme.ts");
      writeFileSync(theme, "@theme {\n  --color-test: red;\n}\n");
      const run = (...args: string[]) =>
        execFileSync(
          process.execPath,
          [join(root, "scripts/sync-theme.mjs"), ...args],
          { stdio: "pipe" }
        );
      run();
      expect(readFileSync(output, "utf8")).toContain(
        "Generated from tailwindcss@4.9.0/theme.css"
      );
      writeFileSync(
        output,
        readFileSync(output, "utf8").replace(/\n/g, "\r\n")
      );
      writeFileSync(theme, readFileSync(theme, "utf8").replace(/\n/g, "\r\n"));
      expect(() => run("--check")).not.toThrow();
      writeFileSync(
        join(root, "node_modules/tailwindcss/package.json"),
        JSON.stringify({ name: "tailwindcss", version: "4.9.1" })
      );
      expect(() => run("--check")).toThrow(/Bundled Tailwind theme is stale/);
      run();
      expect(readFileSync(output, "utf8")).toContain(
        "Generated from tailwindcss@4.9.1/theme.css"
      );
      writeFileSync(theme, "@theme { --color-test: blue; }\n");
      expect(() => run("--check")).toThrow(/Bundled Tailwind theme is stale/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
