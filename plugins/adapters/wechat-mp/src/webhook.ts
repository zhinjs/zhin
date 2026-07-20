/**
 * WeChat MP webhook HTTP: URL verification + inbound message handling.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import {
  getPassiveReplyCapture,
  runWithPassiveReplyCapture,
} from './passive-reply.js';
import {
  buildTextReply,
  computeSignatureHash,
  decryptEchostr,
  decryptMessage,
  encryptMessage,
  formatInboundContent,
  isEncryptedEchostr,
  normalizeEchostrParam,
  parseXMLMessage,
  queryParam,
  readTextBody,
  resolveEventPassiveReply,
  verifySignature,
  type ResolvedWeChatMpConfig,
  type WeChatMessage,
} from './protocol.js';

const logger = getLogger('wechat-mp');

export interface WeChatMpWebhookHandler {
  readonly config: ResolvedWeChatMpConfig;
  readonly isOpen: boolean;
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  admit(msg: WeChatMessage): void;
}

export function registerWeChatMpWebhookRoutes(
  http: HttpHost,
  handler: WeChatMpWebhookHandler,
): HttpRouteRegistration[] {
  const path = handler.config.path;
  return [
    http.route('GET', path, (request, response, url) => {
      handleWeChatMpVerification(request, response, url, handler.config);
    }, { summary: 'WeChat MP URL verification', tags: ['wechat-mp'] }),
    http.route('POST', path, async (request, response, url) => {
      await handleWeChatMpMessage(request, response, url, handler);
    }, { summary: 'WeChat MP inbound webhook', tags: ['wechat-mp'] }),
  ];
}

export function handleWeChatMpVerification(
  _request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  config: ResolvedWeChatMpConfig,
): void {
  const signature = queryParam(url.searchParams.get('signature'));
  const msgSignature = queryParam(url.searchParams.get('msg_signature'));
  const timestamp = queryParam(url.searchParams.get('timestamp'));
  const nonce = queryParam(url.searchParams.get('nonce'));
  const echostr = normalizeEchostrParam(queryParam(url.searchParams.get('echostr')));
  const secureMode = !!(config.encrypt && config.encodingAESKey);
  const signToCheck = msgSignature || signature;
  const signPayload = msgSignature
    ? { signature: msgSignature, timestamp, nonce, echostr }
    : { signature, timestamp, nonce };

  if (!signToCheck || !timestamp || !nonce) {
    response.writeHead(403, { 'Content-Type': 'text/plain' });
    response.end('Forbidden');
    return;
  }

  if (!verifySignature(config.token, signPayload)) {
    const expected = computeSignatureHash(config.token, {
      timestamp,
      nonce,
      ...(msgSignature ? { echostr } : {}),
    });
    logger.error(formatCompact({
      op: 'verify',
      stage: 'sign',
      ok: false,
      expectedPrefix: expected.slice(0, 8),
      gotPrefix: signToCheck.slice(0, 8),
    }));
    response.writeHead(403, { 'Content-Type': 'text/plain' });
    response.end('Forbidden');
    return;
  }

  let body = echostr;
  if (secureMode && echostr && isEncryptedEchostr(echostr) && config.encodingAESKey) {
    try {
      body = decryptEchostr(echostr, config.encodingAESKey, config.appId);
    } catch (error) {
      logger.error(formatCompact({
        op: 'verify',
        stage: 'decrypt',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      response.writeHead(403, { 'Content-Type': 'text/plain' });
      response.end('Forbidden');
      return;
    }
  }

  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end(body);
}

export async function handleWeChatMpMessage(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  handler: WeChatMpWebhookHandler,
): Promise<void> {
  try {
    const config = handler.config;
    const signature = queryParam(url.searchParams.get('signature'));
    const timestamp = queryParam(url.searchParams.get('timestamp'));
    const nonce = queryParam(url.searchParams.get('nonce'));
    const msgSignature = queryParam(url.searchParams.get('msg_signature'));
    const encryptType = queryParam(url.searchParams.get('encrypt_type'));

    if (!verifySignature(config.token, { signature, timestamp, nonce })) {
      logger.error('Invalid signature');
      response.writeHead(403, { 'Content-Type': 'text/plain' });
      response.end('Forbidden');
      return;
    }

    let xmlString = await readTextBody(request);

    if (config.encrypt && encryptType === 'aes' && config.encodingAESKey) {
      xmlString = await decryptMessage(
        xmlString,
        msgSignature,
        timestamp,
        nonce,
        config.token,
        config.encodingAESKey,
        config.appId,
      );
    }

    const wechatMessage = await parseXMLMessage(xmlString);
    if (!wechatMessage) {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('success');
      return;
    }

    let replyXML = resolveEventPassiveReply(wechatMessage);

    if (!replyXML && handler.isOpen) {
      if (config.replyMode === 'passive') {
        replyXML = await collectPassiveReply(handler, wechatMessage);
      } else {
        handler.admit(wechatMessage);
      }
    }

    const encryptReply = !!(
      replyXML
      && config.encodingAESKey
      && encryptType === 'aes'
      && config.encryptMode === 'secure'
    );
    if (encryptReply && config.encodingAESKey) {
      replyXML = encryptMessage(
        replyXML,
        config.token,
        config.encodingAESKey,
        config.appId,
        timestamp,
      );
    }

    response.writeHead(200, { 'Content-Type': 'text/xml' });
    response.end(replyXML || 'success');
  } catch (error) {
    logger.error('Error handling WeChat message:', error);
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('success');
  }
}

export async function collectPassiveReply(
  handler: WeChatMpWebhookHandler,
  wechatMsg: WeChatMessage,
): Promise<string> {
  const timeoutMs = handler.config.passiveReplyTimeoutMs;
  const text = await runWithPassiveReplyCapture(async () => {
    await Promise.race([
      handler.gateway.receive({
        adapter: handler.id,
        target: wechatMsg.FromUserName,
        content: formatInboundContent(wechatMsg),
        sender: wechatMsg.FromUserName,
        id: wechatMsg.MsgId || `${wechatMsg.CreateTime}`,
        metadata: Object.freeze({
          msgType: wechatMsg.MsgType,
          event: wechatMsg.Event,
          endpoint: handler.config.name,
          toUserName: wechatMsg.ToUserName,
        }),
      }),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    return getPassiveReplyCapture()?.text ?? null;
  });
  if (!text) {
    logger.warn(formatCompact({
      op: 'passive_reply',
      ok: false,
      reason: 'timeout_or_empty',
      timeoutMs,
    }));
    return '';
  }
  return buildTextReply(wechatMsg, text);
}
