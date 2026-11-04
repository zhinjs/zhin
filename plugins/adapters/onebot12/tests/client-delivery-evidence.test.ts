import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { ProtocolError } from 'imhelper';
import { Onebot12Client, onebot12ClientOptions, callOnebot12Client, readOnebot12Response } from '../src/client.js';
import { resolveOneBot12Config } from '../src/protocol.js';

it.each(['not_sent', 'unknown'] as const)('retains %s evidence across the real SDK ProtocolError boundary', async disposition => {
  const failure = new EndpointDeliveryError('synthetic', 'synthetic failure', disposition);
  const execute = vi.fn(async () => { throw failure; });
  const client = new Onebot12Client(onebot12ClientOptions(resolveOneBot12Config({ id: 'synthetic', url: 'ws://offline.invalid', platform: 'qq', userId: 'bot' }), execute));
  await expect(callOnebot12Client({ client, action: 'read' })).rejects.toBe(failure);
  expect(execute).toHaveBeenCalledOnce();
});
it('keeps raw native SDK errors and classifies explicit platform rejection in the framework port', async () => {
  const execute = vi.fn(async () => ({ status: 'failed' as const, retcode: 10001, message: 'synthetic rejection' }));
  const client = new Onebot12Client(onebot12ClientOptions(resolveOneBot12Config({ id: 'synthetic', url: 'ws://offline.invalid', platform: 'qq', userId: 'bot' }), execute));
  await expect(client.call('read')).rejects.toBeInstanceOf(ProtocolError);
  await expect(callOnebot12Client({ client, action: 'read' })).rejects.toMatchObject({ disposition: 'rejected' });
  expect(execute).toHaveBeenCalledTimes(2);
});

it.each(['null', '{"status":"unexpected","retcode":0}'])('keeps malformed external response %s unknown rather than claiming rejection', body => {
  expect(() => readOnebot12Response(JSON.parse(body))).toThrow(expect.objectContaining({ disposition: 'unknown' }));
});

it.each([
  { status: 'async', retcode: 1 },
  { retcode: 10001 },
  { status: 'failed', retcode: '10001' },
  { status: 'ok', retcode: 10001 },
  { status: 'failed', retcode: 0 },
])('keeps an unconfirmed response unknown through both direct and native SDK boundaries: %j', async response => {
  expect(() => readOnebot12Response(response)).toThrow(expect.objectContaining({ disposition: 'unknown' }));
  const execute = vi.fn(async () => JSON.parse(JSON.stringify(response)));
  const client = new Onebot12Client(onebot12ClientOptions(resolveOneBot12Config({ id: 'synthetic', platform: 'qq', userId: 'bot', url: 'ws://offline.invalid' }), execute));
  await expect(client.call('read')).rejects.toBeInstanceOf(ProtocolError);
  await expect(callOnebot12Client({ client, action: 'read' })).rejects.toMatchObject({ disposition: 'unknown' });
  expect(execute).toHaveBeenCalledTimes(2);
});
it('returns only an explicitly successful status and retcode', async () => {
  const response = { status: 'ok' as const, retcode: 0, data: { id: 'synthetic' } };
  expect(readOnebot12Response(response)).toEqual({ id: 'synthetic' });
});
