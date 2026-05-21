declare global {
  interface Window {
    __ZHIN_CONSOLE_PAGES_BASE__?: string;
  }
}

const SHELL_ROUTE_NAMES = new Set([
  "dashboard",
  "bots",
  "logs",
  "plugins",
  "marketplace",
  "config",
  "console",
  "sandbox",
  "cron",
  "env",
  "files",
  "database",
]);

/** GitHub project site: https://zhinjs.github.io/zhin/dashboard → /zhin */
export function detectGithubPagesBasename(): string {
  if (!/\.github\.io$/i.test(window.location.hostname)) return "";
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return "";
  if (SHELL_ROUTE_NAMES.has(parts[0]!)) return "";
  return `/${parts[0]}`;
}

/** Router basename for GitHub Pages (`/zhin`) or local preview (`""`). */
export function getRouterBasename(): string | undefined {
  const injected = window.__ZHIN_CONSOLE_PAGES_BASE__?.replace(/\/$/, "");
  if (injected) return injected;
  const detected = detectGithubPagesBasename();
  return detected || undefined;
}
