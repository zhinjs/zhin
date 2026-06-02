import type { RuntimeEnv } from "@zhin.js/contract";

export function serverRuntimeEnv(): RuntimeEnv {
  return process.env.NODE_ENV === "production" ? "production" : "development";
}
