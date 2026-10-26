import { type Locale } from 'zhin.js/i18n';
import { message } from './messages.js';
/**
 * NettoolsService: the single entry point used by chat commands and Agent
 * tools. Each method validates input, spends the caller's cooldown, performs
 * the lookup and returns a ready-to-send text reply. Failures are thrown as
 * NettoolsError; {@link NettoolsService.run} turns them into friendly text.
 */
import {
  classifyParsedHost,
  displayHost,
  parseHostInput,
  reverseLookupName,
} from './address-policy.js';
import { resolveNettoolsConfig, type NettoolsConfig, type ResolvedNettoolsConfig } from './config.js';
import { UserCooldown } from './cooldown.js';
import { DohResolver, formatDnsAnswer, parseDnsType } from './dns.js';
import { comparePrices, formatPriceComparison, parseDomainSuffix, parsePriceKind } from './domain-price.js';
import { describeFailure, NettoolsError } from './errors.js';
import { DEFAULT_RETRY_POLICY, defaultHttpDependencies, HttpClient, type HttpDependencies } from './http.js';
import { formatPingReport, runMultiRegionPing } from './ping.js';
import { assertPublicTarget } from './target-guard.js';
import { formatWhoisRecord, RdapClient } from './whois.js';

export interface NettoolsServiceOptions {
  readonly config?: NettoolsConfig;
  /** Injected for tests: fetch, sleep, clock and randomness. */
  readonly dependencies?: HttpDependencies;
}

export class NettoolsService {
  readonly config: ResolvedNettoolsConfig;
  readonly #http: HttpClient;
  readonly #resolver: DohResolver;
  readonly #rdap: RdapClient;
  readonly #cooldown: UserCooldown;

  constructor(options: NettoolsServiceOptions = {}) {
    this.config = resolveNettoolsConfig(options.config);
    const dependencies = options.dependencies ?? defaultHttpDependencies();
    this.#http = new HttpClient(
      {
        ...DEFAULT_RETRY_POLICY,
        timeoutMs: this.config.requestTimeoutMs,
        maxRetries: this.config.maxRetries,
      },
      dependencies,
    );
    this.#resolver = new DohResolver(this.#http, this.config.dohProviders);
    this.#rdap = new RdapClient(this.#http);
    this.#cooldown = new UserCooldown(this.config.cooldownMs, dependencies.now);
  }

  /** Run one operation and always resolve to a user-facing string. */
  async run(operation: () => Promise<string>, locale: Locale = 'zh-CN'): Promise<string> {
    try {
      return await operation();
    } catch (error) {
      return describeFailure(error, locale);
    }
  }

  async ping(hostInput: string, callerKey: string, signal?: AbortSignal, locale: Locale = 'zh-CN'): Promise<string> {
    const host = parseHostInput(hostInput);
    const verdict = classifyParsedHost(host);
    if (verdict.blocked) {
      throw new NettoolsError('blocked_target', message('probeBlocked', { host: displayHost(host), reason: verdict.detail }));
    }
    this.#cooldown.take(callerKey);
    const target = await assertPublicTarget(hostInput, this.#resolver, signal);
    const report = await runMultiRegionPing(this.#http, target.display, {
      maxNodes: this.config.pingMaxNodes,
      pollIntervalMs: this.config.pingPollIntervalMs,
      maxPolls: this.config.pingMaxPolls,
      ...(signal ? { signal } : {}),
    });
    return formatPingReport(report, locale);
  }

  async whois(domainInput: string, callerKey: string, signal?: AbortSignal, locale: Locale = 'zh-CN'): Promise<string> {
    const host = parseHostInput(domainInput);
    if (host.kind !== 'domain') {
      throw new NettoolsError('invalid_input', message('whoisDomainOnly'));
    }
    const verdict = classifyParsedHost(host);
    if (verdict.blocked) {
      throw new NettoolsError('blocked_target', message('queryBlocked', { host: host.name, reason: verdict.detail }));
    }
    this.#cooldown.take(callerKey);
    const record = await this.#rdap.lookup(host.name, signal);
    return formatWhoisRecord(record, locale);
  }

  async dns(nameInput: string, typeInput: string | undefined, callerKey: string, signal?: AbortSignal, locale: Locale = 'zh-CN'): Promise<string> {
    const type = parseDnsType(typeInput);
    const host = parseHostInput(nameInput, { allowUnderscore: true });
    const verdict = classifyParsedHost(host);
    if (verdict.blocked) {
      throw new NettoolsError('blocked_target', message('queryBlocked', { host: displayHost(host), reason: verdict.detail }));
    }
    if (host.kind !== 'domain' && type !== 'PTR') {
      throw new NettoolsError('invalid_input', message('reverseOnly'));
    }
    const queryName = host.kind === 'domain' ? host.name : reverseLookupName(host);
    this.#cooldown.take(callerKey);
    const answer = await this.#resolver.resolve(queryName, type, signal);
    return formatDnsAnswer(answer, undefined, locale);
  }

  async domainPrice(suffixInput: string, kindInput: string | undefined, callerKey: string, signal?: AbortSignal, locale: Locale = 'zh-CN'): Promise<string> {
    const kind = parsePriceKind(kindInput);
    const suffix = parseDomainSuffix(suffixInput);
    this.#cooldown.take(callerKey);
    const comparison = await comparePrices(this.#http, suffix, kind, signal);
    return formatPriceComparison(comparison, this.config.priceListLimit, locale);
  }
}
