/** Test-only redirect for the installed QQ SDK's fixed production API origin. */
import https from 'node:https';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
const original = https.request;
https.request = function (...args) {
  const first = args[0];
  const hostname = typeof first === 'string' || first instanceof URL ? new URL(first).hostname : first.hostname ?? first.host;
  if (!['api.bot.qq.com', 'api.sgroup.qq.com', 'sandbox.api.bot.qq.com', 'sandbox.api.sgroup.qq.com'].includes(hostname)) return original.apply(this, args);
  const origin = new URL(process.env.ZHIN_FAKE_QQ_ORIGIN);
  if (typeof first === 'string' || first instanceof URL) {
    const url = new URL(first); url.protocol = 'http:'; url.hostname = origin.hostname; url.port = origin.port;
    return http.request(url, ...args.slice(1));
  }
  return http.request({ ...first, protocol: 'http:', hostname: origin.hostname, host: origin.hostname, port: origin.port, agent: undefined }, ...args.slice(1));
};
syncBuiltinESMExports();
