import { generateOrderPin, hashOrderPin, verifyOrderPin } from './order-pin.util';

describe('order-pin.util', () => {
  it('generates a 4-digit pin', () => {
    const pin = generateOrderPin();
    expect(pin).toMatch(/^\d{4}$/);
  });

  it('hashes and verifies pin', async () => {
    const pin = '1234';
    const hash = await hashOrderPin(pin);
    expect(await verifyOrderPin(pin, hash)).toBe(true);
    expect(await verifyOrderPin('9999', hash)).toBe(false);
  });
});
