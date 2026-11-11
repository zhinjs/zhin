/**
 * WeChat MP webhook HTTP: URL verification + inbound message handling.
 */
import type { Locale } from 'zhin.js/i18n';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { readTextBody } from '@zhin.js/host-http-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
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
  formatInboundId,
  isEncryptedEchostr,
  normalizeEchostrParam,
  parseXMLMessage,
  queryParam,
  resolveEventPassiveReply,
  verifySignature,
  wechatMpInboundConversation,
  type ResolvedWeChatMpConfig,
  type WeChatMessage,
} from './protocol.js';

const logger = getLogger('wechat-mp');

export interface WeChatMpWebhookHandler {
  readonly config: ResolvedWeChatMpConfig;
  readonly isOpen: boolean;
  readonly id: CapabilityId;
  admit(msg: WeChatMessage, nativeEvent?: unknown): void | Promise<unknown>;
  resolveLocale?(senderId: string): Promise<Locale | undefined>;
  /** MsgId 去重缓存（可选；实现见 WeChatMpEndpoint）。 */
  getCachedReply?(msgId: string): string | undefined;
  cacheReply?(msgId: string, replyXML: string): void;
}

export function registerWeChatMpWebhookRoutes(
  http: HttpHost,
  handler: WeChatMpWebhookHandler,
): HttpRouteRegistration[] {
  const path = handler.config.path;
  return [
    http.route('GET', path, (request, { url }) => handleWeChatMpVerification(request, url, handler.config), { summary: 'WeChat MP URL verification', tags: ['wechat-mp'] }),
    http.route('POST', path, (request, { url }) => handleWeChatMpMessage(request, url, handler), { summary: 'WeChat MP inbound webhook', tags: ['wechat-mp'] }),
  ];
}

export function handleWeChatMpVerification(
  _request: Request,
  url: URL,
  config: ResolvedWeChatMpConfig,
): Response {
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
    return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
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
    return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
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
      return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
    }
  }

  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

export async function handleWeChatMpMessage(
  request: Request,
  url: URL,
  handler: WeChatMpWebhookHandler,
): Promise<Response> {
  try {
    const config = handler.config;
    const signature = queryParam(url.searchParams.get('signature'));
    const timestamp = queryParam(url.searchParams.get('timestamp'));
    const nonce = queryParam(url.searchParams.get('nonce'));
    const msgSignature = queryParam(url.searchParams.get('msg_signature'));
    const encryptType = queryParam(url.searchParams.get('encrypt_type'));

    if (!verifySignature(config.token, { signature, timestamp, nonce })) {
      logger.error('Invalid signature');
      return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
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
      return new Response('success', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    // 微信 5s 重推去重：同一 MsgId 直接回放首次回复，避免二次 admit。
    const msgId = wechatMessage.MsgId;
    if (msgId && handler.getCachedReply) {
      const cached = handler.getCachedReply(msgId);
      if (cached !== undefined) {
        logger.debug(formatCompact({ op: 'wechat_mp_dedup_replay', msgId }));
        return new Response(cached || 'success', { status: 200, headers: { 'Content-Type': cached ? 'text/xml' : 'text/plain' } });
      }
    }

    const locale = wechatMessage.MsgType === 'event' && wechatMessage.Event === 'subscribe'
      ? await handler.resolveLocale?.(wechatMessage.FromUserName)
      : undefined;
    let replyXML = resolveEventPassiveReply(wechatMessage, locale);

    if (!replyXML && handler.isOpen) {
      if (config.replyMode === 'passive') {
        replyXML = await collectPassiveReply(handler, wechatMessage, xmlString);
      } else {
        handler.admit(wechatMessage, xmlString);
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

    if (msgId && handler.cacheReply) {
      handler.cacheReply(msgId, replyXML || '');
    }

    return new Response(replyXML || 'success', { status: 200, headers: { 'Content-Type': 'text/xml' } });
  } catch (error) {
    logger.error('Error handling WeChat message:', error);
    return new Response('success', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
}

export async function collectPassiveReply(
  handler: WeChatMpWebhookHandler,
  wechatMsg: WeChatMessage,
  nativeEvent?: unknown,
): Promise<string> {
  const timeoutMs = handler.config.passiveReplyTimeoutMs;
  const text = await runWithPassiveReplyCapture(async () => {
    const conversation = wechatMpInboundConversation(String(handler.id), wechatMsg);
    await Promise.race([
      Promise.resolve(nativeEvent === undefined ? handler.admit(wechatMsg) : handler.admit(wechatMsg, nativeEvent)),
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
