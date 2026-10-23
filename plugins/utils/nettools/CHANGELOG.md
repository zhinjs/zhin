# @zhin.js/plugin-nettools

## 0.1.2

### Patch Changes

- Updated dependencies [6da2bad]
- Updated dependencies [3781f1c]
  - @zhin.js/tool@1.1.9
  - @zhin.js/skill@1.1.9

## 0.1.1

### Patch Changes

- 17e1cae: Add `@zhin.js/plugin-nettools`: multi-region `ping` (check-host.net), `whois` (RDAP with rdap.org and WHOIS fallbacks), `dns` over HTTPS (Cloudflare → AliDNS → Google) and `domain-price` comparison (nazhumi.com), plus Agent tools `net_ping`, `whois_lookup`, `dns_lookup` and `domain_price`. Targets are canonicalised and refused when private, loopback, link-local, reserved, multicast or cloud-metadata (including hostnames resolving there); every request has a timeout, retry with exponential backoff and jitter, Retry-After handling and a per-user cooldown.
- Updated dependencies [1a11207]
- Updated dependencies [9943df6]
  - @zhin.js/tool@1.1.8
  - @zhin.js/skill@1.1.8
