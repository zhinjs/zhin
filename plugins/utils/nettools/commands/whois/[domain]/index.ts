import { defineCommand } from 'zhin.js/command';
import { commandCallerKey } from '../../../src/cooldown.js';
import { nettoolsServiceToken } from '../../../src/runtime.js';

export default defineCommand({
  description: '查询域名注册信息（RDAP / WHOIS）', descriptionI18n: { en: "Look up domain registration information using RDAP / WHOIS" },
  params: { domain: { type: 'string', description: '要查询的域名', descriptionI18n: { en: "Domain to look up" } } },
  async execute({ params, input, use, signal, locale }) {
    const service = use(nettoolsServiceToken);
    const domain = String(params.domain ?? '');
    const callerKey = commandCallerKey(input);
    return service.run(() => service.whois(domain, callerKey, signal, locale), locale);
  },
});
