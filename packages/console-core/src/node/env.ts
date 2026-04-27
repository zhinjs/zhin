import type { RuntimeEnv } from "@zhin.js/console-types";

export function serverRuntimeEnv(): RuntimeEnv {
  return process.env.NODE_ENV === "production" ? "production" : "development";
}
