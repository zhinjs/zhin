import { describe, expect, it } from 'vitest';
import { comparePrices, formatPriceComparison, parseDomainSuffix, parsePriceKind, parsePriceResponse } from '../src/domain-price.js';
import { NettoolsError } from '../src/errors.js';
import { createClient, createFakeNetwork, json } from './helpers.js';

const NAZHUMI = {
  code: 100,
  data: {
    domain: 'com',
    price: [
      { registrarname: 'Pricey', registrarweb: 'https://pricey.example/', register: 20, register_cny: 140, renew: 9, renew_cny: 63, currencyname: '美元', promocode: { register: false, renew: true }, updatedtime: '2026-10-20 10:00:00' },
      { registrarname: 'Cheap', registrarweb: 'http://cheap.example/', register: 9, register_cny: 60, renew: 15, renew_cny: 105, currencyname: '美元', promocode: { register: true }, updatedtime: '2026-10-20 12:00:00' },
      { registrarname: 'Broken', register: 'n/a' },
      { register: 1 },
      'junk',
    ],
  },
};

describe('price input parsing', () => {
  it.each([
    ['com', 'com'],
    ['.com', 'com'],
    ['.co.uk', 'co.uk'],
    ['example.com', 'com'],
    ['www.example.co.uk', 'example.co.uk'],
    ['ＣＯＭ', 'com'],
    ['.中国', 'xn--fiqs8s'],
  ])('parses suffix %s → %s', (input, expected) => {
    expect(parseDomainSuffix(input)).toBe(expected);
  });

  it.each(['', '.', '8.8.8.8', 'bad suffix', 'com/x'])('rejects suffix %j', (input) => {
    expect(() => parseDomainSuffix(input)).toThrowError(NettoolsError);
  });

  it('maps price kinds and aliases', () => {
    expect(parsePriceKind(undefined)).toBe('register');
    expect(parsePriceKind('续费')).toBe('renew');
    expect(parsePriceKind('TRANSFER')).toBe('transfer');
    expect(() => parsePriceKind('lease')).toThrowError(NettoolsError);
  });
});

describe('nazhumi parsing', () => {
  it('sorts by CNY for the chosen kind and skips broken rows', () => {
    const register = parsePriceResponse(NAZHUMI, 'com', 'register');
    expect(register.entries.map((entry) => entry.registrar)).toEqual(['Cheap', 'Pricey']);
    expect(register.updatedAt).toBe('2026-10-20 12:00:00');
    expect(register.entries[0]?.website).toBeUndefined();
    const renew = parsePriceResponse(NAZHUMI, 'com', 'renew');
    expect(renew.entries.map((entry) => entry.registrar)).toEqual(['Pricey', 'Cheap']);
    expect(renew.entries[0]?.hasPromoCode).toBe(true);
  });

  it('formats a limited list and an empty result', () => {
    const text = formatPriceComparison(parsePriceResponse(NAZHUMI, 'com', 'register'), 1);
    expect(text).toContain('1. Cheap：9 美元（≈¥60.00） 🎟️有优惠码');
    expect(text).toContain('…共 2 家');
    expect(formatPriceComparison(parsePriceResponse({ code: 100, data: { price: [] } }, 'zz', 'renew'), 5)).toContain('暂无续费价格数据');
  });

  it('reports API error codes and malformed bodies', () => {
    expect(() => parsePriceResponse({ code: 500, msg: 'down' }, 'com', 'register')).toThrowError(/down/u);
    expect(() => parsePriceResponse('nope', 'com', 'register')).toThrowError(NettoolsError);
  });

  it('always queries order=register and sorts locally', async () => {
    const network = createFakeNetwork();
    network.route('www.nazhumi.com/api/v1', () => json(NAZHUMI));
    const comparison = await comparePrices(createClient(network), 'com', 'renew');
    expect(network.calls[0]?.searchParams.get('order')).toBe('register');
    expect(network.calls[0]?.searchParams.get('domain')).toBe('com');
    expect(comparison.entries[0]?.registrar).toBe('Pricey');
  });
});
