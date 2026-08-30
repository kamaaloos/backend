import { generateOrderPin, hashOrderPin, verifyOrderPin } from './order-pin.util';

describe('order-pin.util', () => {
  it('generates a 6-digit pin', () => {
    const pin = generateOrderPin();
    expect(pin).toMatch(/^\d{6}$/);
  });

  it('hashes and verifies pin', async () => {
    const pin = '123456';
    const hash = await hashOrderPin(pin);
    expect(await verifyOrderPin(pin, hash)).toBe(true);
    expect(await verifyOrderPin('999999', hash)).toBe(false);
  });
});
