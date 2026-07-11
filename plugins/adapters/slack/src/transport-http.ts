/**
 * HTTP 传输 — 在 zhin Router 上注册 /slack/events webhook
 */
import { verifySlackSignature } from './signing.js';
import type { SlackEventDispatcher } from './event-dispatcher.js';
import type { SlackEndpointConfig, SlackEventEnvelope, SlackInteractionPayload, SlackSlashCommand, SlackUrlVerification } from './types.js';
import type { Logger } from '@zhin.js/logger';

export type RouterLike = {
  post: (path: string, ...args: any[]) => void;
};

export class SlackHttpTransport {
  constructor(
    private config: SlackEndpointConfig,
    private dispatcher: SlackEventDispatcher,
    private logger: Logger,
  ) {}

  registerRoutes(router: RouterLike): void {
    const signingSecret = this.config.signingSecret;

    router.post('/slack/events', async (ctx: any) => {
      const rawBody = await this.getRawBody(ctx);
      const timestamp = ctx.get?.('X-Slack-Request-Timestamp') ?? ctx.headers?.['x-slack-request-timestamp'] ?? '';
      const signature = ctx.get?.('X-Slack-Signature') ?? ctx.headers?.['x-slack-signature'] ?? '';

      if (!verifySlackSignature(signingSecret, rawBody, timestamp, signature)) {
        ctx.status = 401;
        ctx.body = 'Invalid signature';
        return;
      }

      const contentType: string = ctx.get?.('content-type') ?? ctx.headers?.['content-type'] ?? '';
      let body: unknown;

      if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(rawBody);
        const payloadStr = params.get('payload');
        if (payloadStr) {
          body = JSON.parse(payloadStr);
          ctx.status = 200;
          ctx.body = '';
          this.handleInteraction(body as SlackInteractionPayload);
          return;
        }
        body = Object.fromEntries(params);
        if ((body as any).command) {
          ctx.status = 200;
          ctx.body = '';
          this.dispatcher.routeSlashCommand(body as SlackSlashCommand);
          return;
        }
      } else {
        body = JSON.parse(rawBody);
      }

      const envelope = body as any;

      if (envelope.type === 'url_verification') {
        ctx.status = 200;
        ctx.body = { challenge: (envelope as SlackUrlVerification).challenge };
        return;
      }

      if (envelope.type === 'event_callback' && envelope.event) {
        ctx.status = 200;
        ctx.body = '';
        this.dispatcher.routeEvent((envelope as SlackEventEnvelope).event);
        return;
      }

      ctx.status = 200;
      ctx.body = '';
    });
  }

  private async getRawBody(ctx: any): Promise<string> {
    if (ctx.request?.rawBody) return ctx.request.rawBody;
    if (typeof ctx.request?.body === 'string') return ctx.request.body;
    if (ctx.req) {
      return new Promise<string>((resolve, reject) => {
        let data = '';
        ctx.req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        ctx.req.on('end', () => resolve(data));
        ctx.req.on('error', reject);
      });
    }
    return JSON.stringify(ctx.request?.body ?? {});
  }

  private handleInteraction(payload: SlackInteractionPayload): void {
    this.dispatcher.routeInteraction(payload);
  }
}
