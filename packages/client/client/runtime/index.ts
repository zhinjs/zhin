import type { RuntimeEnv } from "@zhin.js/console-types";

let runtimeEnvFn: (() => RuntimeEnv) | null = null;

export function configureConsole(options: { getRuntimeEnv: () => RuntimeEnv }) {
  runtimeEnvFn = options.getRuntimeEnv;
}

export function getRuntimeEnv(): RuntimeEnv {
  if (runtimeEnvFn) return runtimeEnvFn();
  return "production";
}
