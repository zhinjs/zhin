/** Node / Deno 共用的进程身份与 stdin 绑定（供 ProcessAdapter 使用） */

declare const Deno: {
  pid: number;
  env: { get(key: string): string | undefined };
  stdin: { isTerminal(): boolean; readable: ReadableStream<Uint8Array> };
} | undefined;

export function runtimePid(): string {
  if (typeof Deno !== "undefined") return String(Deno.pid);
  return String(process.pid);
}

export function runtimeUser(): string {
  if (typeof Deno !== "undefined") {
    return Deno.env.get("USER") ?? Deno.env.get("USERNAME") ?? "deno";
  }
  return process.env.USER ?? "user";
}

/** 显式允许在非 TTY 场景绑定 stdin（如 `deno task dev --watch` 子进程） */
export function shouldBindProcessStdin(): boolean {
  if (isDenoDeploy()) return false;
  const force = envFlag("ZHIN_BIND_STDIN");
  if (force === "0" || force === "false") return false;
  if (force === "1" || force === "true") return true;
  return isInteractiveStdin();
}

function envFlag(key: string): string | undefined {
  if (typeof Deno !== "undefined") {
    return Deno.env.get(key)?.trim().toLowerCase();
  }
  return process.env[key]?.trim().toLowerCase();
}

/** 是否适合绑定交互式 stdin（Deploy / 管道场景为 false） */
export function isInteractiveStdin(): boolean {
  if (typeof Deno !== "undefined") {
    try {
      return Deno.stdin.isTerminal();
    } catch {
      return false;
    }
  }
  return Boolean(process.stdin.isTTY);
}

export function isDenoDeploy(): boolean {
  return typeof Deno !== "undefined" &&
    Deno.env.get("DENO_DEPLOYMENT_ID") != null;
}

export function bindStdin(onChunk: (chunk: string) => void): () => void {
  if (typeof Deno !== "undefined") {
    const ac = new AbortController();
    const decoder = new TextDecoder();
    void (async () => {
      try {
        for await (const bytes of Deno.stdin.readable) {
          if (ac.signal.aborted) break;
          onChunk(decoder.decode(bytes));
        }
      } catch {
        /* aborted or stream closed */
      }
    })();
    return () => ac.abort();
  }
  const handler = (data: Buffer) => onChunk(data.toString());
  process.stdin.on("data", handler);
  return () => process.stdin.removeListener("data", handler);
}
