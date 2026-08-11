import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * Stripe API amount conversion: major units (DB Decimal) → integer minor units.
 *
 * Rules follow https://docs.stripe.com/currencies
 * — most currencies: 2 decimal places
 * — zero-decimal: amount equals major units
 * — three-decimal (BHD, …): ×1000, must be divisible by 10
 * — special (ISK/UGX): API still uses ×100 with fractional part always 00
 */

export type MoneyInput = number | string | Decimal;

/** True zero-decimal: charge N major units as amount N. */
const ZERO_DECIMAL = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
]);

/**
 * Present as two-decimal in the API, but fractions must be .00
 * (zero-decimal in practice for charges).
 */
const SPECIAL_TWO_DECIMAL_WHOLE = new Set(['isk', 'ugx']);

/** Three decimal places; Stripe requires minor amount divisible by 10. */
const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

export function stripeCurrencyExponent(currency: string): number {
  const code = currency.trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(code)) {
    throw new BadRequestException(`Invalid currency code: ${currency}`);
  }
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  // Default includes EUR/USD and special ISK/HUF/TWD/UGX (API ×100).
  return 2;
}

function toDecimal(amount: MoneyInput): Decimal {
  try {
    if (amount instanceof Decimal) {
      return amount;
    }
    if (typeof amount === 'number') {
      if (!Number.isFinite(amount)) {
        throw new BadRequestException('Invalid payment amount');
      }
      return new Decimal(amount);
    }
    if (typeof amount === 'string') {
      const trimmed = amount.trim();
      if (!trimmed) {
        throw new BadRequestException('Invalid payment amount');
      }
      return new Decimal(trimmed);
    }
    throw new BadRequestException('Invalid payment amount');
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    throw new BadRequestException('Invalid payment amount');
  }
}

/**
 * Convert a major-unit monetary amount to Stripe's integer minor units.
 * Uses Decimal arithmetic — does not multiply raw JS floats by 100.
 */
export function toStripeAmount(amount: MoneyInput, currency: string): number {
  const code = currency.trim().toLowerCase();
  const decimal = toDecimal(amount);

  if (!decimal.isFinite() || decimal.isNeg()) {
    throw new BadRequestException('Invalid payment amount');
  }

  const exponent = stripeCurrencyExponent(code);
  const places = decimal.decimalPlaces();
  if (places > exponent) {
    throw new BadRequestException(
      `Amount has more than ${exponent} decimal place(s) for ${code.toUpperCase()}`,
    );
  }

  if (SPECIAL_TWO_DECIMAL_WHOLE.has(code) && places > 0) {
    throw new BadRequestException(
      `${code.toUpperCase()} amounts must be whole units (Stripe requires …00 minor digits)`,
    );
  }

  const scale = new Decimal(10).pow(exponent);
  const minor = decimal.mul(scale);

  if (!minor.isInteger()) {
    throw new BadRequestException('Invalid payment amount for Stripe');
  }

  const asNumber = minor.toNumber();
  if (!Number.isSafeInteger(asNumber)) {
    throw new BadRequestException('Payment amount exceeds safe integer range');
  }

  // Three-decimal currencies: Stripe does not support fractional fils below ×10.
  if (THREE_DECIMAL.has(code) && asNumber % 10 !== 0) {
    throw new BadRequestException(
      `${code.toUpperCase()} amount must align to 0.010 (Stripe three-decimal rule)`,
    );
  }

  return asNumber;
}
