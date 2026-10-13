#!/usr/bin/env node
/**
 * One-time OAuth loopback helper.
 *
 *   pnpm --filter @zhin.js/plugin-calendar auth google
 *   pnpm --filter @zhin.js/plugin-calendar auth microsoft
 *
 * Reads credentials from process.env only (does not load .env files).
 * Prints refresh_token for the user to paste into their env — never writes .env.
 */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { spawn } from "node:child_process";
import {
  buildAuthorizeUrl,
  createOAuthState,
  createPkcePair,
  exchangeAuthorizationCode,
} from "../src/oauth-auth.js";

type Provider = "google" | "microsoft";

function usage(): never {
  console.error(`用法：pnpm --filter @zhin.js/plugin-calendar auth <google|microsoft>

环境变量：
  google:    GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET
  microsoft: MS_GRAPH_CLIENT_ID, 可选 MS_GRAPH_CLIENT_SECRET, 可选 MS_GRAPH_TENANT (默认 common)

回调地址固定为 http://127.0.0.1:<port>/callback （默认端口 53682，可用 CALENDAR_OAUTH_PORT 覆盖）。
完成后只打印 refresh_token，请手动写入 .env；本脚本不会改写任何文件。`);
  process.exit(1);
}

function openBrowser(url: string): void {
  const platform = process.platform;
  try {
    if (platform === "darwin")
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    else if (platform === "win32")
      spawn("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
      }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    console.error("无法自动打开浏览器，请手动访问上面的 URL。");
  }
}

async function waitForCode(
  port: number,
  expectedState: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/callback") {
          res.writeHead(404).end("not found");
          return;
        }
        const error = url.searchParams.get("error");
        if (error) {
          res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          res.end(`授权失败：${error}\n可以关闭此页。`);
          server.close();
          reject(
            new Error(
              `OAuth error: ${error} ${
                url.searchParams.get("error_description") ?? ""
              }`
            )
          );
          return;
        }
        const state = url.searchParams.get("state") ?? "";
        const code = url.searchParams.get("code") ?? "";
        if (state !== expectedState) {
          res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          res.end("state 不匹配，请重试。");
          server.close();
          reject(new Error("OAuth state mismatch"));
          return;
        }
        if (!code) {
          res.writeHead(400).end("missing code");
          server.close();
          reject(new Error("missing code"));
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          '<!doctype html><meta charset="utf-8"><title>OK</title><p>授权成功，可以关闭此页回到终端。</p>'
        );
        server.close();
        resolve(code);
      } catch (error) {
        server.close();
        reject(error);
      }
    });
    server.listen(port, "127.0.0.1", () => {
      console.error(`等待回调 http://127.0.0.1:${port}/callback …`);
    });
    server.on("error", reject);
  });
}

async function main(): Promise<void> {
  const provider = (process.argv[2] ?? "").toLowerCase() as Provider | "";
  if (provider !== "google" && provider !== "microsoft") usage();

  const port = Number(process.env.CALENDAR_OAUTH_PORT ?? 53682);
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const clientId =
    provider === "google"
      ? process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() ?? ""
      : process.env.MS_GRAPH_CLIENT_ID?.trim() ?? "";
  const clientSecret =
    provider === "google"
      ? process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() ?? ""
      : process.env.MS_GRAPH_CLIENT_SECRET?.trim() ?? "";
  const tenant = process.env.MS_GRAPH_TENANT?.trim() || "common";

  if (!clientId) {
    console.error(
      provider === "google"
        ? "请先 export GOOGLE_CALENDAR_CLIENT_ID=..."
        : "请先 export MS_GRAPH_CLIENT_ID=..."
    );
    process.exit(1);
  }
  if (provider === "google" && !clientSecret) {
    console.error("Google 需要 export GOOGLE_CALENDAR_CLIENT_SECRET=...");
    process.exit(1);
  }

  const pkce = createPkcePair();
  const state = createOAuthState();
  const authorizeUrl = buildAuthorizeUrl({
    provider,
    clientId,
    redirectUri,
    state,
    codeChallenge: pkce.challenge,
    tenant,
  });

  console.error("\n将打开浏览器完成登录。若未自动打开，请复制以下 URL：\n");
  console.error(authorizeUrl);
  console.error("");

  const codePromise = waitForCode(port, state);
  openBrowser(authorizeUrl);
  const code = await codePromise;

  const tokens = await exchangeAuthorizationCode({
    provider,
    clientId,
    clientSecret: clientSecret || undefined,
    tenant,
    redirectUri,
    code,
    codeVerifier: pkce.verifier,
  });

  const envName =
    provider === "google"
      ? "GOOGLE_CALENDAR_REFRESH_TOKEN"
      : "MS_GRAPH_REFRESH_TOKEN";

  process.stdout.write(
    `\n===== 请把下面的值写入环境变量（不要提交到 git）=====\n${envName}=${tokens.refreshToken}\n====================================================\n\n`
  );
  console.error("本脚本不会写入 .env。请手动粘贴后重启/重载配置。");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
