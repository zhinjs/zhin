---
"@zhin.js/plugin-nettools": patch
---

Add `@zhin.js/plugin-nettools`: multi-region `ping` (check-host.net), `whois` (RDAP with rdap.org and WHOIS fallbacks), `dns` over HTTPS (Cloudflare → AliDNS → Google) and `domain-price` comparison (nazhumi.com), plus Agent tools `net_ping`, `whois_lookup`, `dns_lookup` and `domain_price`. Targets are canonicalised and refused when private, loopback, link-local, reserved, multicast or cloud-metadata (including hostnames resolving there); every request has a timeout, retry with exponential backoff and jitter, Retry-After handling and a per-user cooldown.
