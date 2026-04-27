import "./style.css";
import * as React from "react";
import * as ReactJsxDevRuntime from "react/jsx-dev-runtime";
import * as ReactJsxRuntime from "react/jsx-runtime";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as ReactRouterDOM from "react-router-dom";
import {
  CONSOLE_HOST_REACT_NAMESPACE_KEY,
  CONSOLE_SHARED_MODULES_KEY,
} from "@zhin.js/console-types";
import { BrowserRouter } from "react-router-dom";
import { useWebSocket } from "@zhin.js/client";
import { ConsoleWebHost } from "./host/ConsoleWebHost";
import { registerBuiltinConsolePages } from "@console/registerBuiltinShell";
import { initializeTheme } from "@console/theme";
import { hasToken } from "@console/utils/auth";
import LoginPage from "@console/pages/login";
import { TooltipProvider } from "@console/components/ui/tooltip";

initializeTheme();

const consoleHostReactNamespace = Object.assign(
  Object.create(null),
  React,
  ReactJsxRuntime,
  ReactJsxDevRuntime,
);
(globalThis as Record<string, unknown>)[CONSOLE_HOST_REACT_NAMESPACE_KEY] =
  consoleHostReactNamespace;

const sharedModules = new Map<string, unknown>();
sharedModules.set("react", React);
sharedModules.set("react/jsx-runtime", ReactJsxRuntime);
sharedModules.set("react/jsx-dev-runtime", ReactJsxDevRuntime);
sharedModules.set("react-dom", ReactDOM);
sharedModules.set("react-dom/client", ReactDOMClient);
sharedModules.set("react-router", ReactRouterDOM);
sharedModules.set("react-router-dom", ReactRouterDOM);
(globalThis as Record<string, unknown>)[CONSOLE_SHARED_MODULES_KEY] = sharedModules;

registerBuiltinConsolePages();

function ConsoleShell() {
  useWebSocket();

  return <ConsoleWebHost />;
}

function App() {
  const [authed, setAuthed] = React.useState(hasToken());
  const handleLogin = React.useCallback(() => setAuthed(true), []);

  React.useEffect(() => {
    const onAuthRequired = () => setAuthed(false);
    window.addEventListener("zhin:auth-required", onAuthRequired);
    return () => window.removeEventListener("zhin:auth-required", onAuthRequired);
  }, []);

  if (!authed) {
    return <LoginPage onSuccess={handleLogin} />;
  }

  return <ConsoleShell />;
}

ReactDOMClient.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <App />
      </BrowserRouter>
    </TooltipProvider>
  </React.StrictMode>,
);
