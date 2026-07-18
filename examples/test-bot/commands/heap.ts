import { defineCommand } from '@zhin.js/command';
import { writeHeapSnapshot } from 'node:v8';
import path from 'node:path';
import * as os from 'node:os';

export default defineCommand({
  description: '写一份 V8 heap snapshot 到临时目录',
  execute: () => {
    const file = path.join(
      os.tmpdir(),
      `zhin-heap-${process.pid}-${Date.now()}.heapsnapshot`,
    );
    writeHeapSnapshot(file);
    return `heap snapshot written:\n${file}`;
  },
});
