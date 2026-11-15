/**
 * Browser entry the plugin page audit bundles for each page (audit/plugin-pages.mjs). It renders the
 * page the way the Console shell does: `PageShell` + `PageHeader` from the page meta, the page body
 * inside a `PageChromeProvider`. Hand-written React pages are mounted directly; declarative
 * blueprints, adapter pages and comment review pages are rendered by the Console renderers
 * (`@zhin.js/client`), so they need a mount module (`mountModule` in the request) exporting
 * `mountPluginPage(context)`; without one they are reported as not mounted.
 *
 * @typedef {object} MountPluginPageContext
 * @property {HTMLElement} element                    root element of the page
 * @property {{ default?: unknown, meta?: object }} pageModule  the page module (`meta` from definePage)
 * @property {string} pageName
 * @property {'light' | 'dark'} theme
 * @property {(body: import('react').ReactNode) => void} renderInShell  renders `body` inside the shell
 *
 * The result is published on `window.__zhinUiAudit` = { status: 'mounted' | 'unsupported' | 'error', message? }.
 */
import { Component, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ConsoleUiI18nProvider,
  PageChromeActions,
  PageChromeProvider,
  PageHeader,
  PageShell,
  createPageChromeStore
} from "@zhin.js/console-ui";
function publish(state) {
  window.__zhinUiAudit = state;
}
class Boundary extends Component {
  state = { error: void 0 };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    publish({ status: "error", message: error instanceof Error ? error.message : String(error) });
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}
function Shell({ pageModule, pageName, children }) {
  const [store] = useState(createPageChromeStore);
  const meta = pageModule.meta ?? {};
  const width = meta.fullWidth ? "full" : meta.contentWidth ?? "data";
  return <ConsoleUiI18nProvider locale="zh-CN">
      <PageShell width={width}>
        <PageHeader title={meta.title ?? pageName} description={meta.description} actions={<PageChromeActions store={store} />} />
        <PageChromeProvider store={store}>
          <Boundary>{children}</Boundary>
        </PageChromeProvider>
      </PageShell>
    </ConsoleUiI18nProvider>;
}
function isBlueprint(value) {
  const kind = value?.kind;
  return typeof kind === "string" && kind.startsWith("zhin.console.");
}
async function mountAuditPage(pageModule, pageName, custom) {
  const params = new URLSearchParams(location.search);
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  document.documentElement.classList.toggle("dark", theme === "dark");
  window.addEventListener("error", (event) => publish({ status: "error", message: event.message }));
  const element = document.getElementById("root") ?? document.body.appendChild(document.createElement("div"));
  const root = createRoot(element);
  const renderInShell = (body) => root.render(<Shell pageModule={pageModule} pageName={pageName}>{body}</Shell>);
  try {
    const Page = pageModule.default;
    if (custom?.mountPluginPage) {
      await custom.mountPluginPage({ element, pageModule, pageName, theme, renderInShell });
    } else if (isBlueprint(Page)) {
      publish({ status: "unsupported", message: "declarative blueprint / adapter page: needs a renderer mount module (mountModule)" });
      return;
    } else if (typeof Page === "function") {
      const Body = Page;
      renderInShell(<Body />);
    } else {
      publish({ status: "error", message: "the page module has no default-exported component" });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!window.__zhinUiAudit) publish({ status: "mounted" });
  } catch (error) {
    publish({ status: "error", message: error instanceof Error ? error.message : String(error) });
  }
}
export {
  mountAuditPage
};
