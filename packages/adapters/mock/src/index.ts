import { Adapter } from 'zhin';
import type {} from '@zhinjs/web';

const adapter = new Adapter('console');
const startBots = () => {
  adapter.app!.web.ws.on('message', e => {});
};
const stopBots = () => {};
adapter.on('start', startBots);
adapter.on('stop', stopBots);
export default adapter;
