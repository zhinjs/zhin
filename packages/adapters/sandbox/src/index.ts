import { defineMetadata, onMount, withService } from 'zhin';
import type {} from '@zhinjs/web';
import path from 'path';
defineMetadata({ name: 'sandbox web' });
withService('web');
onMount(app => {
  app.web.addEntry(path.resolve(__dirname, '../client/index.ts'));
});
