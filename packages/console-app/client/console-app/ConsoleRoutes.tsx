import * as React from "react";
import { Route } from "react-router-dom";
import { app } from "@zhin.js/client";
import { DEFAULT_CONSOLE_BASE_PATH } from "@zhin.js/console-types";

const basePrefix = DEFAULT_CONSOLE_BASE_PATH.endsWith("/")
  ? DEFAULT_CONSOLE_BASE_PATH
  : `${DEFAULT_CONSOLE_BASE_PATH}/`;

function toRelativeRoutePath(abs: string): string {
  if (abs.startsWith(basePrefix)) return abs.slice(basePrefix.length);
  if (abs === DEFAULT_CONSOLE_BASE_PATH) return "";
  return abs.startsWith("/") ? abs.slice(1) : abs;
}

export function useConsoleRouteElements(): React.ReactElement {
  const v = React.useSyncExternalStore(app.subscribe, app.getVersion, app.getVersion);
  void v;
  const routeRecords = app._getRoutes();

  return (
    <>
      {routeRecords.map((r) => (
        <Route key={r.path} path={toRelativeRoutePath(r.path)} element={app._renderRouteElement(r)} />
      ))}
    </>
  );
}
