#!/usr/bin/env node
/**
 * One-time OAuth loopback helper for Google Calendar / Microsoft Graph.
 *
 * After installing the package:
 *   npx zhin-calendar-auth google
 *   npx zhin-calendar-auth microsoft
 *
 * Inside the zhin monorepo:
 *   pnpm --filter @zhin.js/plugin-calendar auth google
 *
 * Reads credentials from process.env only (does not load .env files).
 * Prints the refresh token for the user to paste into their env and never writes files.
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
} from "../oauth-auth.js";

type Provider = "google" | "microsoft";

const DEFAULT_CALLBACK_PORT = 53682;

function printUsageAndExit(): never {
  console.error(`用法：npx zhin-calendar-auth <google|microsoft>

环境变量：
  google:    GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET
  microsoft: MS_GRAPH_CLIENT_ID, 可选 MS_GRAPH_CLIENT_SECRET, 可选 MS_GRAPH_TENANT (默认 common)

回调地址固定为 http://127.0.0.1:<port>/callback （默认端口 ${DEFAULT_CALLBACK_PORT}，可用 CALENDAR_OAUTH_PORT 覆盖）。
完成后只打印 refresh_token，请手动写入 .env；本工具不会改写任何文件。`);
  process.exit(1);
}

function getBrowserCommand(url: string): { command: string; args: string[] } {
  if (process.platform === "darwin") {
    return { command: "open", args: [url] };
  }
  if (process.platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }
  return { command: "xdg-open", args: [url] };
}

function openBrowser(url: string): void {
  const { command, args } = getBrowserCommand(url);
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {
      console.error("无法自动打开浏览器，请手动访问上面的 URL。");
    });
    child.unref();
  } catch {
    console.error("无法自动打开浏览器，请手动访问上面的 URL。");
  }
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  text: string
): void {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
  });
  response.end(text);
}

function waitForAuthorizationCode(
  port: number,
  expectedState: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer(
      (request: IncomingMessage, response: ServerResponse) => {
        const fail = (statusCode: number, text: string, error: Error) => {
          sendText(response, statusCode, text);
          server.close();
          reject(error);
        };

        try {
          const callbackUrl = new URL(request.url ?? "/", "http://127.0.0.1");
          if (callbackUrl.pathname !== "/callback") {
            sendText(response, 404, "not found");
            return;
          }

          const oauthError = callbackUrl.searchParams.get("error");
          if (oauthError) {
            const description =
              callbackUrl.searchParams.get("error_description") ?? "";
            fail(
              400,
              `授权失败：${oauthError}\n可以关闭此页。`,
              new Error(`OAuth error: ${oauthError} ${description}`.trim())
            );
            return;
          }

          const state = callbackUrl.searchParams.get("state") ?? "";
          if (state !== expectedState) {
            fail(
              400,
              "state 不匹配，请重试。",
              new Error("OAuth state mismatch")
            );
            return;
          }

          const code = callbackUrl.searchParams.get("code") ?? "";
          if (!code) {
            fail(400, "missing code", new Error("missing code"));
            return;
          }

          response.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
          });
          response.end(
            '<!doctype html><meta charset="utf-8"><title>OK</title><p>授权成功，可以关闭此页回到终端。</p>'
          );
          server.close();
          resolve(code);
        } catch (error) {
          server.close();
          reject(error);
        }
      }
    );

    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      console.error(`等待回调 http://127.0.0.1:${port}/callback …`);
    });
  });
}

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function parseProvider(value: string | undefined): Provider {
  const normalized = (value ?? "").toLowerCase();
  if (normalized === "google" || normalized === "microsoft") {
    return normalized;
  }
  return printUsageAndExit();
}

async function main(): Promise<void> {
  const provider = parseProvider(process.argv[2]);
  const isGoogle = provider === "google";

  const port = Number(process.env.CALENDAR_OAUTH_PORT ?? DEFAULT_CALLBACK_PORT);
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const clientIdEnvName = isGoogle
    ? "GOOGLE_CALENDAR_CLIENT_ID"
    : "MS_GRAPH_CLIENT_ID";
  const clientSecretEnvName = isGoogle
    ? "GOOGLE_CALENDAR_CLIENT_SECRET"
    : "MS_GRAPH_CLIENT_SECRET";
  const refreshTokenEnvName = isGoogle
    ? "GOOGLE_CALENDAR_REFRESH_TOKEN"
    : "MS_GRAPH_REFRESH_TOKEN";

  const clientId = readEnv(clientIdEnvName);
  const clientSecret = readEnv(clientSecretEnvName);
  const tenant = readEnv("MS_GRAPH_TENANT") || "common";

  if (!clientId) {
    console.error(`请先 export ${clientIdEnvName}=...`);
    process.exit(1);
  }
  if (isGoogle && !clientSecret) {
    console.error(`Google 需要 export ${clientSecretEnvName}=...`);
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

  const codePromise = waitForAuthorizationCode(port, state);
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

  const output = [
    "",
    "===== 请把下面的值写入环境变量（不要提交到 git）=====",
    `${refreshTokenEnvName}=${tokens.refreshToken}`,
    "====================================================",
    "",
    "",
  ].join("\n");
  process.stdout.write(output);
  console.error("本工具不会写入 .env。请手动粘贴后重启/重载配置。");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
