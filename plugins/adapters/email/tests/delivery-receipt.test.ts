import { EventEmitter } from 'node:events';
import { EmailEndpoint } from '../src/endpoint.js';
import { resolveEmailConfig } from '../src/protocol.js';
import type { EmailImapTransport, EmailSmtpResult } from '../src/transport.js';
import { emailDeliveryRuntime } from './runtime-delivery.js';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';

const config = resolveEmailConfig({ id: 'fixture', smtp: { host: 'smtp.fixture', port: 465, secure: true, auth: { user: 'bot@example.com', pass: 'fixture' } }, imap: { host: 'imap.fixture', port: 993, tls: true, user: 'fixture', password: 'fixture' } });
async function fixture(result: EmailSmtpResult | Error) {
  const imap = Object.assign(new EventEmitter(), { connect() { queueMicrotask(() => this.emit('ready')); }, end() {}, openBox() {}, search() {}, fetch() {} }) as unknown as EmailImapTransport;
  const sendMail = vi.fn(async () => { if (result instanceof Error) throw result; return result; });
  const endpoint = new EmailEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'email'), config, createImap: () => imap, createSmtp: () => ({ verify: async () => {}, close: () => {}, sendMail }) });
  return { ...(await emailDeliveryRuntime(endpoint)), sendMail };
}
it.each([
  [{ messageId: 'fixture', accepted: ['actor@example.com'], rejected: [] }, 'sent', undefined, false],
  [{ messageId: 'fixture', accepted: [], rejected: ['actor@example.com'] }, 'failed', 'platform_rejected', false],
  [{ messageId: 'fixture', accepted: ['actor@example.com'], rejected: ['other@example.com'] }, 'failed', 'delivery_unconfirmed', true],
  [{ messageId: 'fixture', accepted: ['actor@example.com'], rejected: [], pending: ['other@example.com'] }, 'failed', 'delivery_unconfirmed', true],
  [{ messageId: 'fixture', accepted: ['other@example.com'], rejected: [] }, 'failed', 'delivery_unconfirmed', true],
  [{ messageId: 'fixture' }, 'failed', 'delivery_unconfirmed', true],
  [{ messageId: 'fixture', accepted: [], rejected: ['actor@example.com'], pending: ['other@example.com'] }, 'failed', 'delivery_unconfirmed', true],
  [{ messageId: 'fixture', accepted: [], rejected: ['other@example.com'] }, 'failed', 'delivery_unconfirmed', true],
  [{ messageId: 'fixture', accepted: ['actor@example.com'], rejected: [], envelope: { to: ['actor@example.com', 'other@example.com'] } }, 'failed', 'delivery_unconfirmed', true],
  [{ accepted: ['actor@example.com'], rejected: [] }, 'failed', 'delivery_unconfirmed', true],
] as const)('projects SMTP recipient evidence into the final Core receipt: %j', async (result, status, code, unknown) => {
  const runtime = await fixture(result);
  try {
    const receipt = await runtime.send(); expect(receipt.status).toBe(status);
    if (code) expect(receipt.failure?.code).toBe(code);
    expect(receipt.failure?.deliveryUnknown === true).toBe(unknown);
    expect(runtime.sendMail).toHaveBeenCalledTimes(1);
  } finally { await runtime.close(); }
});
it.each([
  [Object.assign(new Error('private response body'), { responseCode: 550 }), 'platform_rejected', false],
  [Object.assign(new Error('private response body'), { responseCode: 451 }), 'platform_rejected', false],
  [new Error('connection lost after DATA'), 'delivery_unconfirmed', true],
] as const)('classifies errors safely through Core with no retries: %s', async (error, code, unknown) => {
  const runtime = await fixture(error);
  try {
    const receipt = await runtime.send(); expect(receipt).toMatchObject({ status: 'failed', failure: { code } });
    expect(receipt.failure?.deliveryUnknown === true).toBe(unknown);
    expect(JSON.stringify(receipt)).not.toContain('private response body'); expect(runtime.sendMail).toHaveBeenCalledTimes(1);
  } finally { await runtime.close(); }
});
it.each(['reply', 'face'])('rejects unimplemented semantic segment %s before SMTP instead of dropping it', async type => {
  const runtime = await fixture({ messageId: 'fixture', accepted: ['actor@example.com'], rejected: [] });
  try {
    await expect(runtime.send([{ type: 'text', data: { text: 'neighbor' } }, { type, data: { message_id: '<fixture@example.com>' } }])).resolves.toMatchObject({ status: type === 'reply' ? 'unsupported' : 'rejected', failure: { code: type === 'reply' ? 'unsupported_operation' : 'outbound_payload_rejected' } });
    expect(runtime.sendMail).not.toHaveBeenCalled();
  } finally { await runtime.close(); }
});
