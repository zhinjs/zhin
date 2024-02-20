import { Plugin } from '@';

const echo = new Plugin('echo');
echo.command('发送 <msg:any>')
  .desc('输出指定信息')
  .alias('echo')
  .action((_, msg) => msg);
export default echo;
