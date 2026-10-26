import { defineCommand } from 'zhin.js/command';
import { commandCallerKey } from '../../../../src/cooldown.js';
import { nettoolsServiceToken } from '../../../../src/runtime.js';

export default defineCommand({
  description: 'DNS 查询（DoH），类型可选 A/AAAA/CNAME/MX/TXT/NS/SOA/CAA/SRV/PTR/DS/DNSKEY', descriptionI18n: { en: "DNS lookup over HTTPS; supports A/AAAA/CNAME/MX/TXT/NS/SOA/CAA/SRV/PTR/DS/DNSKEY" },
  params: {
    name: { type: 'string', description: '域名；PTR 查询时可填 IP', descriptionI18n: { en: "Domain name, or an IP address for PTR queries" } },
    type: { type: 'string', description: '记录类型，默认 A', descriptionI18n: { en: "Record type (default: A)" } },
  },
  async execute({ params, input, use, signal, locale }) {
    const service = use(nettoolsServiceToken);
    const name = String(params.name ?? '');
    const type = params.type == null ? undefined : String(params.type);
    const callerKey = commandCallerKey(input);
    return service.run(() => service.dns(name, type, callerKey, signal, locale), locale);
  },
});
