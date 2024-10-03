import { Plugin as Plugin } from '@zhinjs/core';
const echo = new Plugin('echo');
echo
  .command('发送 <msg:any>')
  .desc('输出指定信息')
  .permission('master', 'admin', 'admins')
  .alias('echo')
  .action((_, msg) => msg);

export default echo;
