# @zhin.js/plugin-nettools

Network tools for Zhin.js: multi-region ping, RDAP whois, DNS-over-HTTPS lookups and domain price comparison. Platform-agnostic, keyless (every upstream API is public), with per-user cooldown, an SSRF guard and resilient HTTP.

## Installation

```bash
pnpm exec zhin install @zhin.js/plugin-nettools
```

## Usage

Run the installation command from your application directory. It installs the package and mounts the `nettools` instance in 主配置 `plugins` 映射. The corresponding `zhin.config.yml` node is:

```yaml
configVersion: 2
plugins:
  nettools: "@zhin.js/plugin-nettools"
nettools: {}
```

### Commands

| Command | Description | Upstream |
|---------|-------------|----------|
| `ping <host>` | Ping a public host from several regions; shows average/min/max latency and packet loss per node | [check-host.net](https://check-host.net/about/api) |
| `whois <domain>` | Registrar, creation/expiry/update dates, status, name servers, DNSSEC | RDAP via the [IANA bootstrap](https://data.iana.org/rdap/dns.json), fallback [rdap.org](https://rdap.org), then the [60s API](https://60s.viki.moe) WHOIS (covers `.cn` and other TLDs without RDAP; registrant personal data is not shown) |
| `dns <name> [type]` | DNS records; `type` is one of `A AAAA CNAME MX TXT NS SOA CAA SRV PTR DS DNSKEY` (default `A`). `dns 1.1.1.1 PTR` does a reverse lookup | Cloudflare DoH, fallback AliDNS DoH, then Google DoH |
| `domain-price <suffix> [register\|renew\|transfer]` (alias `域名比价`) | Cheapest registrars for a suffix (`com`, `.cn`, `.co.uk`, or a full domain); Chinese kinds `注册 / 续费 / 转入` also work | [nazhumi.com](https://www.nazhumi.com) |

### Agent tools

Skill `nettools` exposes `net_ping`, `whois_lookup`, `dns_lookup` and `domain_price`, sharing the same validation, cooldown and resilience as the commands.

## Configuration

All fields are optional; defaults are conservative because every upstream is a free, shared service. Out-of-range values are clamped.

| Field | Default | Range | Meaning |
|-------|---------|-------|---------|
| `cooldownSeconds` | `10` | 0–3600 | Per-user cooldown shared by all commands/tools (0 disables). Spent after input validation, so typos are free |
| `requestTimeoutMs` | `8000` | 1000–30000 | Timeout for each HTTP attempt |
| `maxRetries` | `2` | 0–5 | Retries for transient failures |
| `pingMaxNodes` | `4` | 1–10 | check-host.net probe nodes |
| `pingPollIntervalMs` | `2000` | 500–10000 | Wait between result polls |
| `pingMaxPolls` | `5` | 1–10 | Poll budget; unfinished nodes are reported as "no result" |
| `dohProviders` | `["cloudflare", "alidns", "google"]` | — | DoH providers in fallback order |
| `priceListLimit` | `8` | 1–20 | Registrars shown per comparison |

```yaml
nettools:
  cooldownSeconds: 30
  pingMaxNodes: 6
```

## Security: target policy (SSRF guard)

User input is canonicalised with the WHATWG URL host parser (the parser `fetch` uses), so odd spellings such as `2130706433`, `0x7f.1`, `017700000001`, `127.1` or `[::ffff:127.0.0.1]` are checked in their real form. URLs, ports, paths, user-info, zone ids and percent-encoding are refused outright.

Refused targets:

- IPv4: `0.0.0.0/8`, private `10/8`, `172.16/12`, `192.168/16`, CGNAT `100.64/10`, loopback `127/8`, link-local `169.254/16`, IETF/documentation/benchmark ranges, multicast `224/4`, reserved `240/4`;
- IPv6: `::`, `::1`, ULA `fc00::/7`, link-local `fe80::/10`, site-local `fec0::/10`, multicast `ff00::/8`, documentation, Teredo, anything outside global unicast `2000::/3`; IPv4-mapped, NAT64 and 6to4 addresses are unwrapped and judged by their embedded IPv4;
- cloud metadata: `169.254.169.254`, `169.254.170.2`, `100.100.100.200`, `168.63.129.16`, `fd00:ec2::254`, `metadata.google.internal`, …;
- names: single-label hosts, `localhost`, and internal/reserved suffixes (`.local`, `.internal`, `.lan`, `.home.arpa`, `.test`, `.invalid`, …).

For `ping`, hostnames are also resolved (A + AAAA over DoH) and refused if **any** address is blocked; resolution failure fails closed. The probe itself runs on check-host.net, so this process never connects to the target.

## Resilience

Every external request has a per-attempt timeout, retries network errors, timeouts, 408/425/429/5xx with exponential backoff plus jitter, honours `Retry-After` up to 10 s (longer waits fail fast with a rate-limit message), caps response bodies at 1 MiB and parses JSON defensively. DoH falls back Cloudflare → AliDNS → Google (only one retry per provider while another remains, to bound latency); whois falls back registry RDAP → rdap.org → 60s WHOIS (the IANA bootstrap is cached for 24 h, stale copies are reused if IANA is down); a failed ping poll does not discard a running check. Failures are reported as short, specific messages.
