#!/usr/bin/env node
/**
 * GitHub Pages: SPA deep-link fallback (404.html) and optional basename injection.
 * @see https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-custom-404-page-for-your-github-pages-site
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(packageRoot, "dist");
const indexPath = path.join(distDir, "index.html");

if (!fs.existsSync(indexPath)) {
  console.error("[prepare-github-pages] Missing dist/index.html — run build first.");
  process.exit(1);
}

let html = fs.readFileSync(indexPath, "utf8");
const pagesBase = (process.env.CONSOLE_PAGES_BASE ?? "").replace(/\/$/, "");
if (pagesBase && !html.includes("__ZHIN_CONSOLE_PAGES_BASE__")) {
  const tag = `<script>window.__ZHIN_CONSOLE_PAGES_BASE__=${JSON.stringify(pagesBase)}</script>`;
  if (/<head[\s>]/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  } else if (/<html[\s>]/i.test(html)) {
    html = html.replace(/<html([^>]*)>/i, `<html$1>${tag}`);
  } else {
    html = tag + html;
  }
}

fs.writeFileSync(indexPath, html);
fs.copyFileSync(indexPath, path.join(distDir, "404.html"));
fs.writeFileSync(path.join(distDir, ".nojekyll"), "");

const cname = (process.env.CONSOLE_PAGES_CNAME ?? "").trim();
if (cname) {
  fs.writeFileSync(path.join(distDir, "CNAME"), `${cname}\n`);
}

console.log(
  `[prepare-github-pages] SPA fallback: 404.html, .nojekyll${pagesBase ? `, base=${pagesBase}` : ", base=/"}${
    cname ? `, CNAME=${cname}` : ""
  }`,
);
