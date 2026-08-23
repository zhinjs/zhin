import {
  DOCS_INSIGHTS_CONSENT_KEY,
  buildDocsInsight,
  sanitizeDocsPath,
  sanitizeSearchTerm,
  shouldCollectDocsInsights,
  viewportBucket,
} from '../../docs/.vitepress/theme/docs-insights.js';

describe('documentation insights privacy boundary', () => {
  it('requires an endpoint, explicit consent, and no DNT signal', () => {
    expect(shouldCollectDocsInsights({ endpoint: '', consent: 'granted', doNotTrack: '0' })).toBe(false);
    expect(shouldCollectDocsInsights({ endpoint: '/events', consent: null, doNotTrack: '0' })).toBe(false);
    expect(shouldCollectDocsInsights({ endpoint: '/events', consent: 'granted', doNotTrack: '1' })).toBe(false);
    expect(shouldCollectDocsInsights({ endpoint: '/events', consent: 'granted', doNotTrack: 'yes' })).toBe(false);
    expect(shouldCollectDocsInsights({ endpoint: '/events', consent: 'granted', doNotTrack: '0' })).toBe(true);
    expect(DOCS_INSIGHTS_CONSENT_KEY).toBe('zhin:docs-insights-consent:v1');
  });

  it('removes query strings, fragments, credentials, and sensitive search text', () => {
    expect(sanitizeDocsPath('https://zhin.dev/configuration/?token=secret#http')).toBe('/configuration/');
    expect(sanitizeDocsPath('/en/ai/?utm_source=x')).toBe('/en/ai/');
    expect(sanitizeSearchTerm('workroom routing')).toEqual({ term: 'workroom routing', redacted: false });
    expect(sanitizeSearchTerm('alice@example.com token=abc123')).toEqual({ term: undefined, redacted: true });
    expect(sanitizeSearchTerm('https://private.example/path')).toEqual({ term: undefined, redacted: true });
    expect(sanitizeSearchTerm('sk-proj-abcdefghijk')).toEqual({ term: undefined, redacted: true });
    expect(sanitizeSearchTerm('ghp_abcdefghijklmnopqrstuvwxyz')).toEqual({ term: undefined, redacted: true });
    expect(sanitizeSearchTerm('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature')).toEqual({ term: undefined, redacted: true });
    expect(sanitizeSearchTerm('hunter2secret')).toEqual({ term: undefined, redacted: true });
    expect(sanitizeSearchTerm('api key notarealcredential')).toEqual({ term: undefined, redacted: true });
    expect(sanitizeSearchTerm('abcdefghijklmnopqrstuvwxyzabcdef')).toEqual({ term: undefined, redacted: true });
  });

  it('builds anonymous, bounded content events', () => {
    expect(viewportBucket(390)).toBe('phone');
    expect(viewportBucket(1024)).toBe('tablet');
    expect(viewportBucket(1920)).toBe('desktop');

    const event = buildDocsInsight({
      event: 'search_no_results',
      path: '/en/?debug=true',
      previousPath: 'https://zhin.dev/en/start/?secret=x',
      viewportWidth: 1920,
      siteId: 'docs',
      search: 'unknown adapter',
      resultCount: 0,
    });
    expect(event).toEqual({
      schemaVersion: 1,
      event: 'search_no_results',
      path: '/en/',
      previousPath: '/en/start/',
      locale: 'en',
      viewport: 'desktop',
      siteId: 'docs',
      searchTerm: 'unknown adapter',
      searchRedacted: false,
      resultCount: 0,
    });
    expect(JSON.stringify(event)).not.toMatch(/user|cookie|referrer|debug=true|secret=x/iu);
  });
});
