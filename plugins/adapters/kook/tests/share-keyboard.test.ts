import { formatOutboundKmarkdown } from '../src/protocol.js';
it.each(['share', 'keyboard'])('rejects unimplemented %s instead of confirming an empty fallback', type => {
  expect(() => formatOutboundKmarkdown([{ type: 'text', data: { text: 'probe' } }, { type, data: {} }])).toThrow('not implemented');
});
