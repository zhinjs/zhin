/**
 * OAuth redirect endpoint mounted on zhin's shared HTTP host.
 */
import type { CallbackResult } from "./chat-auth.js";

export interface CalendarRouteHost {
  route(
    method: string,
    path: string,
    handler: (
      request: Request,
      context: { readonly url: URL }
    ) => Response | Promise<Response>,
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
    async (_request, { url }) => {
      const result = await handleCallback(url.searchParams);
      return new Response(renderPage(result), { status: result.statusCode, headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      } });
    },
    { summary: "Calendar OAuth callback", tags: ["calendar"] }
  );
}
