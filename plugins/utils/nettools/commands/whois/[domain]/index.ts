import { defineCommand } from 'zhin.js/command';
import { commandCallerKey } from '../../../src/cooldown.js';
import { nettoolsServiceToken } from '../../../src/runtime.js';

export default defineCommand({
  description: '查询域名注册信息（RDAP / WHOIS）',
  params: { domain: { type: 'string', description: '要查询的域名' } },
  async execute({ params, input, use, signal }) {
    const service = use(nettoolsServiceToken);
    const domain = String(params.domain ?? '');
    const callerKey = commandCallerKey(input);
    return service.run(() => service.whois(domain, callerKey, signal));
  },
});
