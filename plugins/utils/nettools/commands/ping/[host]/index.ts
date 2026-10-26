import { defineCommand } from 'zhin.js/command';
import { commandCallerKey } from '../../../src/cooldown.js';
import { nettoolsServiceToken } from '../../../src/runtime.js';

export default defineCommand({
  description: '从多个地区 Ping 一个公网主机（check-host.net）', descriptionI18n: { en: "Ping a public host from multiple regions (check-host.net)" },
  params: { host: { type: 'string', description: '域名或公网 IP', descriptionI18n: { en: "Domain name or public IP address" } } },
  async execute({ params, input, use, signal, locale }) {
    const service = use(nettoolsServiceToken);
    const host = String(params.host ?? '');
    const callerKey = commandCallerKey(input);
    return service.run(() => service.ping(host, callerKey, signal, locale), locale);
  },
});
