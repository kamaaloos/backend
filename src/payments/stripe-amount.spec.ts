/// <reference types="jest" />
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { stripeCurrencyExponent, toStripeAmount } from './stripe-amount';

describe('toStripeAmount', () => {
  it('converts EUR via Decimal without float multiply', () => {
    expect(toStripeAmount(new Decimal('18.50'), 'eur')).toBe(1850);
    expect(toStripeAmount('18.50', 'EUR')).toBe(1850);
    expect(toStripeAmount(18.5, 'eur')).toBe(1850);
  });

  it('converts zero-decimal JPY as major units', () => {
    expect(toStripeAmount(500, 'jpy')).toBe(500);
    expect(toStripeAmount('500', 'JPY')).toBe(500);
  });

  it('converts three-decimal BHD (×1000, divisible by 10)', () => {
    expect(toStripeAmount('10.000', 'bhd')).toBe(10000);
    expect(toStripeAmount('1.230', 'bhd')).toBe(1230);
  });

  it('rejects BHD amounts not aligned to 0.010', () => {
    expect(() => toStripeAmount('1.234', 'bhd')).toThrow(BadRequestException);
    expect(() => toStripeAmount('1.235', 'bhd')).toThrow(BadRequestException);
  });

  it('requires whole ISK (API still ×100)', () => {
    expect(toStripeAmount(5, 'isk')).toBe(500);
    expect(() => toStripeAmount('5.50', 'isk')).toThrow(BadRequestException);
  });

  it('rejects NaN, Infinity, and negative amounts', () => {
    expect(() => toStripeAmount(Number.NaN, 'eur')).toThrow(BadRequestException);
    expect(() => toStripeAmount(Number.POSITIVE_INFINITY, 'eur')).toThrow(
      BadRequestException,
    );
    expect(() => toStripeAmount(-10, 'eur')).toThrow(BadRequestException);
    expect(() => toStripeAmount('-1.00', 'eur')).toThrow(BadRequestException);
  });

  it('rejects excess decimal places for the currency', () => {
    expect(() => toStripeAmount('10.001', 'eur')).toThrow(BadRequestException);
    expect(() => toStripeAmount('10.1', 'jpy')).toThrow(BadRequestException);
  });

  it('reports exponents for known classes', () => {
    expect(stripeCurrencyExponent('eur')).toBe(2);
    expect(stripeCurrencyExponent('jpy')).toBe(0);
    expect(stripeCurrencyExponent('bhd')).toBe(3);
  });
});
