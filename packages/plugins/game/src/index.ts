import type {} from '@zhinjs/plugin-drawer';
import { Plugin } from 'zhin';
import * as fs from 'fs';
import * as path from 'path';
import * as process from 'process';
const plugin = new Plugin('monitor');
plugin.mounted(() => {
  const drawer = plugin.createDrawer();
  drawer.rect(10, 10).fill('#f06').radius(2);
  drawer.circle(50).move(100, 100).fill('#0f6');
  drawer.ellipse(40, 50).move(20, 200).fill('#60f');
  drawer.line(50, 40, 100, 100).stroke({ width: 2 }).stroke('#f06');
  drawer.polyline([0, 0, 100, 50, 50, 100, 0, 0]).fill('#f60');
  drawer.text('hello world').size(20).move(40, 80).stroke('#777');
  drawer
    .image(path.join(process.cwd(), 'data', 'test.png'))
    .width(100)
    .height(200)
    .move(100, 100);
  fs.writeFileSync(path.resolve(process.cwd(), 'data', 'test.png'), drawer.render());
});
export default plugin;
