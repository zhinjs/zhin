/** Copy to commands/acceptance/index.ts only in an authorized test project. */
import { adapterFeatureId, type AdapterIndex, endpointControlOf } from 'zhin.js/adapter';
import { outboundMessageToken } from 'zhin.js/core/runtime';
import { defineCommand } from 'zhin.js/command';
import { appendFile, open, readFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Fixed 128x128 opaque RGB PNG; the original RGBA fixture remains the default.
const RGB_IMAGE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAAyElEQVR42u3RQQ0AAAjEsJODRCQiCxnwaDIFa6pHh8UCAAAEAIAAABAAAAIAQAAACAAAAQAgAAAEAIAAABAAAAIAQAAACAAAAQAgAAAEAIAAABAAAAIAQAAACAAAAQAgAAAEAIAAABAAAAIAQAAACAAAAQAAwAUAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIAAABACAAAAQAgAAAEAAAAgBAAAAIwIcWbWwFRyxto9QAAAAASUVORK5CYII=';

export default defineCommand({
  description: 'Opt-in platform acceptance reply probe',
  async execute(context) {
    const { input } = context;
    const policyPath = process.env.ZHIN_ACCEPTANCE_POLICY;
    if (!policyPath || !input?.$reply) return;
    const policy = JSON.parse(await readFile(policyPath, 'utf8'));
    if (policy.version !== 1 || !Array.isArray(policy.actions) || !Number.isInteger(policy.minIntervalMs) || policy.minIntervalMs < 1000 || !Number.isInteger(policy.maxSends) || policy.maxSends < 1 || !Array.isArray(policy.targets)) return;
    const conversation = input.conversation;
    const endpoint = String(context.endpoint ?? '');
    const target = policy.targets.find((item: any) => item.adapter === conversation.endpoint.adapter && item.endpoint === endpoint && item.kind === conversation.kind && item.id === conversation.id);
    if (!target || !/^[a-zA-Z0-9_-]{1,48}$/.test(target.alias)) return;
    const sampleText = input.content.match(/(?:^|\s)probe:([a-zA-Z0-9_-]{8,64})(?:\s|$)/)?.[1];
    if (!sampleText) return;
    const action = input.content.match(/(?:^|\s)action:([a-z-]+)(?:\s|$)/)?.[1] ?? 'reply-text';
    if (!policy.actions.includes(action)) return;
    const requestedImage = input.content.match(/(?:^|\s)image:([^\s]+)(?:\s|$)/)?.[1];
    if (requestedImage !== undefined && (action !== 'reply-image' || !['rgb', 'legacy'].includes(requestedImage))) return;
    const imageSample = requestedImage ?? 'legacy';
    const index = context.project<AdapterIndex>(adapterFeatureId);
    const activeEndpoint = index.connection(conversation.endpoint.adapter, endpoint);
    const resolvedId = index.resolve(conversation.endpoint.adapter, endpoint);
    if (!resolvedId || index.clientAdapter(resolvedId) !== policy.platform) return;
    const sample = createHash('sha256').update(`${target.alias}:${action}:${sampleText}${action === 'reply-image' && imageSample === 'rgb' ? ':image:rgb' : ''}`).digest('hex');
    const lockPath = `${policy.eventsPath}.lock`;
    let lock;
    try { lock = await open(lockPath, 'wx', 0o600); } catch { return; }
    const start = Date.now();
    let result = 'blocked';
    let callbackObserved = false;
    let callbackAssociation = 'none';
    let callbackPending = false;
    const writeResult = async (outcome: string, observed = false) => {
      await appendFile(policy.eventsPath, JSON.stringify({ version: 1, phase: 'result', platform: policy.platform, action, ...(action === 'reply-image' ? { imageSample } : {}), generation: context.generation, pid: process.pid, transportState: activeEndpoint?.transportState ?? 'unknown', admitted: index.describe().find(row => row.id === index.resolve(conversation.endpoint.adapter, endpoint))?.admitted ?? false, target: target.alias, sample, time: new Date().toISOString(), result: outcome, ...(action === 'reply-button' ? { callbackObserved: observed, callbackAssociation } : {}), latencyMs: Date.now() - start, rssBytes: process.memoryUsage().rss }) + '\n', { mode: 0o600 });
    };
    try {
      let events: any[] = [];
      try { events = (await readFile(policy.eventsPath, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      const attempts = events.filter(item => item.phase === 'attempt');
      const previous = attempts.at(-1);
      if (!events.some(item => item.sample === sample) && attempts.length < policy.maxSends && (!previous || start - Date.parse(previous.time) >= policy.minIntervalMs)) {
        // The same unified Message.$reply path used by normal commands.
        result = 'unknown';
        await appendFile(policy.eventsPath, JSON.stringify({ version: 1, phase: 'attempt', action, ...(action === 'reply-image' ? { imageSample } : {}), target: target.alias, sample, time: new Date(start).toISOString(), result: 'unknown' }) + '\n', { mode: 0o600 });
        try {
          const text = `acceptance:${target.alias}:${sampleText}`;
          let payload: any = text;
          if (action === 'reply-image') payload = [{ type: 'text', data: { text } }, { type: 'image', data: { media: { kind: 'base64', mime_type: 'image/png', value: imageSample === 'rgb' ? RGB_IMAGE_PNG : 'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAfUlEQVR4nO3PsQ0AIRADQSqhWGqipm8DOsDBB3snbeBwJc84e57X5vqeo/tBHxBAHxBAHxBAH/gNqH4w9QLoXgDdC6D7/oDqB1MvgO4F0L0Auu8PqH4w9QLoXgDdC6D7/oDqB1MvgO4F0L0Auu8PqH4w9QLoXgDdC6D79oAL8zj/2ifK324AAAAASUVORK5CYII=' } } }];
          if (action === 'reply-quote') payload = [{ type: 'reply', data: { message_id: String(input.id ?? '') } }, { type: 'text', data: { text } }];
          if (action === 'reply-markdown') payload = [{ type: 'markdown', data: { content: `**${text}**\n\nInline code: \`acceptance\`\n\n[Zhin](https://zhin.dev)\n\nEscaping: & < >` } }];
          if (action === 'reply-share') payload = [{ type: 'text', data: { text } }, { type: 'share', data: { url: 'https://zhin.dev', title: 'Zhin 适配器验收', description: '公开项目链接，验证分享标题、描述及目标地址。' } }];
          if (action === 'reply-button') {
            if (index.segmentPolicy(resolvedId)?.interactive !== 'native') result = 'unsupported';
            else {
              const callback = `accbtn:${sample.slice(0,32)}`;
              let sourceMessageId: string | undefined;
              let settled = false;
              let timer: ReturnType<typeof setTimeout> | undefined;
              let release = () => {};
              const finish = (observed: boolean) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                release();
                // Do not await the callback inside this command: serial polling needs
                // the command to return before it can fetch the next update.
                void writeResult(observed ? 'confirmed' : 'unknown', observed).catch(() => {});
              };
              release = context.use(outboundMessageToken).registerInteractiveHandler(callback, (message) => {
                if (settled) return false;
                if (message.conversation.endpoint.id !== conversation.endpoint.id || message.conversation.endpoint.adapter !== conversation.endpoint.adapter || message.conversation.kind !== conversation.kind
                  || message.conversation.id !== conversation.id || message.sender?.id !== input.sender?.id
                  || message.conversation.parent?.id !== conversation.parent?.id || message.conversation.parent?.kind !== conversation.parent?.kind || message.conversation.threadId !== conversation.threadId) return false;
                if (policy.platform === 'telegram' && message.metadata.sourceMessageId === undefined) return false;
                if (policy.platform === 'qq' && (message.metadata.eventType !== 'INTERACTION_CREATE'
                  || (conversation.kind === 'channel' && message.metadata.sourceMessageId === undefined)
                  || (message.metadata.sourceMessageId === undefined && message.metadata.sourceMessageIdAvailable !== false))) return false;
                if (message.metadata.sourceMessageId !== undefined && String(message.metadata.sourceMessageId) !== sourceMessageId) return false;
                if (!message.segments?.some(segment => segment.type === 'action' && segment.data?.payload === callback)) return false;
                callbackAssociation = message.metadata.sourceMessageId !== undefined ? 'source-message' : 'payload-conversation-actor';
                callbackObserved = true;
                finish(true);
                return true;
              });
              try {
                const rawReceipt = await input.$reply([{ type: 'text', data: { text } }, { type: 'keyboard', data: { rows: [[{ id: 'acceptance-confirm', label: '确认验收', payload: callback }]] } }]);
                const receipt = rawReceipt && typeof rawReceipt === 'object' ? rawReceipt as { status?: string; message?: { id?: string }; failure?: { deliveryUnknown?: boolean } } : undefined;
                sourceMessageId = receipt?.message?.id;
                if (receipt?.status === 'sent' && sourceMessageId) {
                  callbackPending = true;
                  timer = setTimeout(() => finish(false), 60_000);
                  timer.unref?.();
                } else result = receipt?.status === 'unsupported' ? 'unsupported' : receipt?.failure?.deliveryUnknown ? 'unknown' : 'failed';
              } finally { if (!callbackPending) { settled = true; release(); } }
            }
          } else if (action === 'reply-markdown' && index.segmentPolicy(resolvedId)?.markdown !== 'native') {
            result = 'unsupported';
          } else if (action === 'reply-share' && index.segmentPolicy(resolvedId)?.supported
            && !index.segmentPolicy(resolvedId)?.supported?.includes('share')) {
            result = 'unsupported';
          } else if (action === 'reply-interaction') {
            if (!context.interaction) { result = 'unsupported'; }
            else { const answer = await context.interaction.ask({ type: 'confirm', title: text, timeout: 60000 }); result = typeof answer === 'boolean' ? 'confirmed' : 'unknown'; }
          } else {
            const receipt: any = await input.$reply(payload);
            result = receipt?.failure?.deliveryUnknown ? 'unknown' : receipt?.status === 'sent' && receipt.message?.id ? 'confirmed' : receipt?.status === 'unsupported' ? 'unsupported' : ['rejected', 'failed', 'suppressed'].includes(receipt?.status) ? 'failed' : 'unknown';
            if (action === 'reply-recall' && result === 'confirmed') {
              const control = endpointControlOf(activeEndpoint);
              if (!control?.recall) result = 'unsupported'; else await control.recall(receipt.message);
            }
          }
        }
        catch (error: any) { result = error?.code === 'unsupported_operation' && error?.disposition === 'not_sent' ? 'unsupported' : ['not_sent', 'rejected'].includes(error?.disposition) ? 'failed' : 'unknown'; }
      }
      if (!callbackPending) await writeResult(result, callbackObserved);
    } finally { await lock.close(); await unlink(lockPath); }
  },
});
