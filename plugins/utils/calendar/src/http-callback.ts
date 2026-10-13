/**
 * OAuth redirect endpoint mounted on zhin's shared HTTP host.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CallbackResult } from "./chat-auth.js";

export interface CalendarRouteHost {
  route(
    method: string,
    path: string,
    handler: (
      request: IncomingMessage,
      response: ServerResponse,
      url: URL
    ) => void | Promise<void>,
    meta?: { readonly summary?: string; readonly tags?: readonly string[] }
  ): () => void;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderPage(result: CallbackResult): string {
  return [
    "<!doctype html>",
    '<meta charset="utf-8">',
    "<title>zhin calendar</title>",
    `<p>${escapeHtml(result.message)}</p>`,
  ].join("\n");
}

export function registerOAuthCallbackRoute(
  http: CalendarRouteHost,
  callbackPath: string,
  handleCallback: (searchParams: URLSearchParams) => Promise<CallbackResult>
): () => void {
  return http.route(
    "GET",
    callbackPath,
    async (_request, response, url) => {
      const result = await handleCallback(url.searchParams);
      response.writeHead(result.statusCode, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(renderPage(result));
    },
    { summary: "Calendar OAuth callback", tags: ["calendar"] }
  );
}
