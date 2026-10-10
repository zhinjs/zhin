// Keep the official MIT-licensed Tailwind theme available without runtime file I/O.
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const css = await readFile(require.resolve("tailwindcss/theme.css"), "utf8");
const output = new URL("../src/default-theme.ts", import.meta.url);
const source =
  "// Generated from tailwindcss@4.3.3/theme.css (MIT, Tailwind Labs).\n" +
  "// Run pnpm sync:theme after updating the pinned Tailwind dependency.\n" +
  "// prettier-ignore\n" +
  `export const defaultTheme = ${JSON.stringify(css)};\n`;
if (process.argv.includes("--check")) {
  if ((await readFile(output, "utf8")) !== source) {
    throw new Error("Bundled Tailwind theme is stale; run pnpm sync:theme.");
  }
} else {
  await writeFile(output, source);
}
