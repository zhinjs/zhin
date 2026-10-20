import { filterImDeliveryContent } from '../../src/segment/filter-im-delivery.js';

describe('filterImDeliveryContent', () => {
  it('passes plain string unchanged', () => {
    expect(filterImDeliveryContent('hello')).toBe('hello');
  });

  it('strips thinking and tool_call from segment arrays', () => {
    const input = [
      { type: 'thinking', data: { text: 'internal' } },
      { type: 'text', data: { text: 'visible' } },
      { type: 'tool_call', data: { name: 'bash', args: {} } },
      { type: 'mention', data: { target: '1', name: 'Bot' } },
    ];
    expect(filterImDeliveryContent(input)).toEqual([
      { type: 'text', data: { text: 'visible' } },
      { type: 'mention', data: { target: '1', name: 'Bot' } },
    ]);
  });

  it('returns empty array when only AI-only segments remain', () => {
    expect(filterImDeliveryContent([
      { type: 'thinking', data: { text: 'x' } },
    ])).toEqual([]);
  });

  it('preserves non-segment elements (e.g. JSX components)', () => {
    const component = { type: { name: 'Card' }, data: { title: 't' } };
    const input = [
      { type: 'tool_call', data: { name: 'x' } },
      component,
      { type: 'text', data: { text: 'ok' } },
    ];
    expect(filterImDeliveryContent(input as never)).toEqual([
      component,
      { type: 'text', data: { text: 'ok' } },
    ]);
  });
});
