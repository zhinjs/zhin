import { formatOutboundSegments } from '../src/protocol.js';
it.each(['markdown', 'share', 'keyboard'])('rejects unsupported %s before wire sending', type => {
  expect(() => formatOutboundSegments([{ type: 'text', data: { text: 'probe' } }, { type, data: { content: 'sample' } }])).toThrow(expect.objectContaining({ code: 'unsupported_operation', disposition: 'not_sent' }));
});
