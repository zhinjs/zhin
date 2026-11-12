import { HttpBodyError, jsonResponse, type HttpHandler } from '@zhin.js/host-http';

/** Adds `Cache-Control: no-store` unless the response already sets a cache policy. */
export function withNoStore(response: Response): Response {
  if (response.headers.has('cache-control')) return response;
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** A route whose every response, including request-body errors, is `no-store`. */
export function noStore(handler: HttpHandler): HttpHandler {
  return async (request, context) => {
    try {
      return withNoStore(await handler(request, context));
    } catch (error) {
      if (error instanceof HttpBodyError) {
        return withNoStore(jsonResponse(error.statusCode, { success: false, error: error.message }));
      }
      throw error;
    }
  };
}
