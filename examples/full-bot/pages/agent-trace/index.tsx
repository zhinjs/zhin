import { TraceArchivePage } from '@zhin.js/client';
import { definePage } from '@zhin.js/console-contract';

export const meta = definePage({
  title: 'Agent Trace',
  icon: 'Activity',
  order: 31,
});

export default TraceArchivePage;
