import { createMessages, type Locale } from 'zhin.js/i18n';

const catalog = {
  "cloudMetadata": {
    "zh-CN": "云服务元数据地址",
    "en": "Cloud metadata address"
  },
  "unspecifiedV4": {
    "zh-CN": "未指定 / “本网络”地址",
    "en": "Unspecified / current-network address"
  },
  "privateV4": {
    "zh-CN": "私有地址 (RFC 1918)",
    "en": "Private address (RFC 1918)"
  },
  "cgnat": {
    "zh-CN": "运营商级 NAT 地址 (CGNAT, RFC 6598)",
    "en": "Carrier-grade NAT address (CGNAT, RFC 6598)"
  },
  "loopback": {
    "zh-CN": "回环地址",
    "en": "Loopback address"
  },
  "linkLocal": {
    "zh-CN": "链路本地地址",
    "en": "Link-local address"
  },
  "ietfReserved": {
    "zh-CN": "IETF 协议保留地址",
    "en": "IETF protocol reserved address"
  },
  "documentation": {
    "zh-CN": "文档示例地址",
    "en": "Documentation address"
  },
  "relay6to4": {
    "zh-CN": "已废弃的 6to4 中继地址",
    "en": "Deprecated 6to4 relay address"
  },
  "benchmark": {
    "zh-CN": "基准测试保留地址",
    "en": "Benchmarking address"
  },
  "multicast": {
    "zh-CN": "组播地址",
    "en": "Multicast address"
  },
  "reservedBroadcast": {
    "zh-CN": "保留地址（含广播地址）",
    "en": "Reserved address (including broadcast)"
  },
  "teredo": {
    "zh-CN": "Teredo 隧道地址",
    "en": "Teredo tunnel address"
  },
  "orchid": {
    "zh-CN": "ORCHID 保留地址",
    "en": "ORCHID reserved address"
  },
  "hostRequired": {
    "zh-CN": "请提供主机名或 IP 地址",
    "en": "Provide a hostname or IP address"
  },
  "hostTooLong": {
    "zh-CN": "主机名过长",
    "en": "Hostname is too long"
  },
  "bareHost": {
    "zh-CN": "只接受裸主机名或 IP，不要带协议、端口、路径或特殊字符",
    "en": "Use a bare hostname or IP, without a scheme, port, path or special characters"
  },
  "ipv6NoPort": {
    "zh-CN": "不是有效的 IPv6 地址（如需端口请去掉端口）",
    "en": "Invalid IPv6 address; omit any port"
  },
  "invalidHost": {
    "zh-CN": "不是有效的主机名或 IP 地址",
    "en": "Invalid hostname or IP address"
  },
  "hostLength": {
    "zh-CN": "主机名长度不合法",
    "en": "Invalid hostname length"
  },
  "fullDomain": {
    "zh-CN": "请提供完整域名（例如 example.com）",
    "en": "Provide a full domain name, such as example.com"
  },
  "invalidLabel": {
    "zh-CN": "域名标签不合法：{label}",
    "en": "Invalid domain label: {label}"
  },
  "empty": {
    "zh-CN": "(空)",
    "en": "(empty)"
  },
  "numericTld": {
    "zh-CN": "顶级域不能是纯数字",
    "en": "The top-level domain cannot be entirely numeric"
  },
  "notIp": {
    "zh-CN": "不是 IP 地址：{address}",
    "en": "Not an IP address: {address}"
  },
  "localhost": {
    "zh-CN": "本机主机名",
    "en": "Local hostname"
  },
  "reservedSuffix": {
    "zh-CN": "内网或保留域名后缀 .{suffix}",
    "en": "Private or reserved domain suffix .{suffix}"
  },
  "unspecifiedV6": {
    "zh-CN": "未指定地址 (::)",
    "en": "Unspecified address (::)"
  },
  "loopbackV6": {
    "zh-CN": "回环地址 (::1)",
    "en": "Loopback address (::1)"
  },
  "mappedV4": {
    "zh-CN": "IPv4 映射地址",
    "en": "IPv4-mapped address"
  },
  "nat64": {
    "zh-CN": "NAT64 地址",
    "en": "NAT64 address"
  },
  "localNat64": {
    "zh-CN": "本地 NAT64 地址",
    "en": "Local NAT64 address"
  },
  "sixToFour": {
    "zh-CN": "6to4 地址",
    "en": "6to4 address"
  },
  "ula": {
    "zh-CN": "唯一本地地址 (ULA, fc00::/7)",
    "en": "Unique-local address (ULA, fc00::/7)"
  },
  "linkLocalV6": {
    "zh-CN": "链路本地地址 (fe80::/10)",
    "en": "Link-local address (fe80::/10)"
  },
  "siteLocalV6": {
    "zh-CN": "已废弃的站点本地地址 (fec0::/10)",
    "en": "Deprecated site-local address (fec0::/10)"
  },
  "multicastV6": {
    "zh-CN": "组播地址 (ff00::/8)",
    "en": "Multicast address (ff00::/8)"
  },
  "notGlobalV6": {
    "zh-CN": "非全球单播 IPv6 地址",
    "en": "Non-global-unicast IPv6 address"
  },
  "embeddedV4": {
    "zh-CN": "{wrapper}指向 {address}（{reason}）",
    "en": "{wrapper} points to {address} ({reason})"
  },
  "invalidV4": {
    "zh-CN": "不是有效的 IPv4 地址：{address}",
    "en": "Invalid IPv4 address: {address}"
  },
  "invalidV6": {
    "zh-CN": "不是有效的 IPv6 地址：{address}",
    "en": "Invalid IPv6 address: {address}"
  },
  "invalidV6Group": {
    "zh-CN": "IPv6 分组不合法：{group}",
    "en": "Invalid IPv6 group: {group}"
  },
  "reverseNeedsIp": {
    "zh-CN": "反向解析需要 IP 地址",
    "en": "Reverse lookup requires an IP address"
  },
  "probeBlocked": {
    "zh-CN": "拒绝探测 {host}：{reason}",
    "en": "Refused to probe {host}: {reason}"
  },
  "queryBlocked": {
    "zh-CN": "拒绝查询 {host}：{reason}",
    "en": "Refused to query {host}: {reason}"
  },
  "whoisDomainOnly": {
    "zh-CN": "whois 目前只支持域名查询",
    "en": "WHOIS supports domain names only"
  },
  "reverseOnly": {
    "zh-CN": "IP 地址只能做反向解析，请使用 PTR 记录类型",
    "en": "IP addresses only support reverse lookup; select the PTR record type"
  },
  "noAddresses": {
    "zh-CN": "无法解析 {host}（没有 A/AAAA 记录）",
    "en": "Cannot resolve {host} (no A/AAAA records)"
  },
  "resolvedBlocked": {
    "zh-CN": "拒绝探测 {host}：解析到 {address}（{reason}）",
    "en": "Refused to probe {host}: resolves to {address} ({reason})"
  },
  "unknownAddress": {
    "zh-CN": "无法识别的地址记录",
    "en": "Unrecognized address record"
  },
  "cooldown": {
    "zh-CN": "操作太频繁，请 {seconds} 秒后再试",
    "en": "Too many requests. Try again in {seconds} seconds"
  },
  "dnsType": {
    "zh-CN": "不支持的记录类型 {type}，可选：{types}",
    "en": "Unsupported record type {type}; choose {types}"
  },
  "queryFailed": {
    "zh-CN": "{provider} 查询失败",
    "en": "{provider} lookup failed"
  },
  "dnsUnavailable": {
    "zh-CN": "所有 DNS 服务均不可用：{failures}",
    "en": "All DNS services are unavailable: {failures}"
  },
  "dnsMalformed": {
    "zh-CN": "{provider} 返回了无法识别的 DNS 响应",
    "en": "{provider} returned an unrecognized DNS response"
  },
  "dnsFailed": {
    "zh-CN": "{provider} 解析失败（{rcode}）",
    "en": "{provider} lookup failed ({rcode})"
  },
  "requestFailed": {
    "zh-CN": "{provider} 请求失败",
    "en": "{provider} request failed"
  },
  "responseMalformed": {
    "zh-CN": "{provider} 返回了无法解析的数据",
    "en": "{provider} returned data that could not be parsed"
  },
  "timeout": {
    "zh-CN": "{provider} 响应超时（{seconds}s）",
    "en": "{provider} timed out ({seconds}s)"
  },
  "network": {
    "zh-CN": "无法连接 {provider}：{detail}",
    "en": "Cannot connect to {provider}: {detail}"
  },
  "rateLimited": {
    "zh-CN": "{provider} 请求过于频繁，请稍后再试",
    "en": "{provider} rate limit reached; try again later"
  },
  "http": {
    "zh-CN": "{provider} 返回错误 HTTP {status}",
    "en": "{provider} returned HTTP {status}"
  },
  "tooLarge": {
    "zh-CN": "响应体过大，已拒绝读取",
    "en": "Response body is too large; reading was refused"
  },
  "providerAborted": {
    "zh-CN": "{provider} 请求已取消",
    "en": "{provider} request was cancelled"
  },
  "aborted": {
    "zh-CN": "请求已取消",
    "en": "Request was cancelled"
  },
  "pingRefused": {
    "zh-CN": "check-host.net 拒绝了请求：{detail}",
    "en": "check-host.net refused the request: {detail}"
  },
  "pingMalformed": {
    "zh-CN": "check-host.net 返回了无法识别的数据",
    "en": "check-host.net returned unrecognized data"
  },
  "priceKind": {
    "zh-CN": "价格类型可选：注册(register) / 续费(renew) / 转入(transfer)",
    "en": "Price type must be register, renew, or transfer"
  },
  "suffixRequired": {
    "zh-CN": "请提供域名后缀，例如 com 或 .cn",
    "en": "Provide a domain suffix, such as com or .cn"
  },
  "suffixNotIp": {
    "zh-CN": "请提供域名或后缀，而不是 IP 地址",
    "en": "Provide a domain name or suffix, rather than an IP address"
  },
  "priceMalformed": {
    "zh-CN": "nazhumi.com 返回了无法识别的数据",
    "en": "nazhumi.com returned unrecognized data"
  },
  "priceError": {
    "zh-CN": "nazhumi.com 返回错误 {code}{detail}",
    "en": "nazhumi.com returned error {code}{detail}"
  },
  "rdapFailed": {
    "zh-CN": "RDAP / WHOIS 查询失败",
    "en": "RDAP / WHOIS lookup failed"
  },
  "ianaMalformed": {
    "zh-CN": "IANA RDAP 引导数据格式异常",
    "en": "Invalid IANA RDAP bootstrap data"
  },
  "rdapMalformed": {
    "zh-CN": "RDAP 返回了无法识别的数据",
    "en": "RDAP returned unrecognized data"
  },
  "rdapNotDomain": {
    "zh-CN": "RDAP 返回的不是域名对象",
    "en": "RDAP did not return a domain object"
  },
  "whoisMalformed": {
    "zh-CN": "WHOIS 服务返回了无法识别的数据",
    "en": "WHOIS service returned unrecognized data"
  },
  "whoisError": {
    "zh-CN": "WHOIS 服务返回错误 {code}",
    "en": "WHOIS service returned error {code}"
  },
  "unexpected": {
    "zh-CN": "出错了：{detail}",
    "en": "An error occurred: {detail}"
  }
} as const;
const translate = createMessages(catalog);

export type NettoolsMessageKey = keyof typeof catalog;
export type NettoolsMessageValue = string | number | NettoolsMessage | readonly (string | NettoolsMessage)[];
export interface NettoolsMessage {
  readonly key: NettoolsMessageKey;
  readonly values: Readonly<Record<string, NettoolsMessageValue>>;
}

/** Stable source keys preserve nested provider/target reasons until the caller chooses a language. */
export function message(key: NettoolsMessageKey, values: Readonly<Record<string, NettoolsMessageValue>> = {}): NettoolsMessage {
  return { key, values };
}

export function formatMessage(detail: NettoolsMessage, locale: Locale = 'zh-CN'): string {
  const value = (item: NettoolsMessageValue): string | number => {
    if (typeof item === 'string' || typeof item === 'number') return item;
    if (Array.isArray(item)) return item.map((part) => value(part)).join(locale === 'en' ? '; ' : '；');
    return formatMessage(item as NettoolsMessage, locale);
  };
  return translate(locale, detail.key, Object.fromEntries(Object.entries(detail.values).map(([key, item]) => [key, value(item)])));
}
