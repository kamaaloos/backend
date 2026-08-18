import { parseCookieHeader, REFRESH_COOKIE } from './cookie.util';

describe('parseCookieHeader', () => {
  it('returns the named cookie value', () => {
    expect(
      parseCookieHeader(`other=1; ${REFRESH_COOKIE}=abc.123; theme=dark`, REFRESH_COOKIE),
    ).toBe('abc.123');
  });

  it('decodes URI-encoded values', () => {
    expect(parseCookieHeader(`${REFRESH_COOKIE}=a%2Fb`, REFRESH_COOKIE)).toBe(
      'a/b',
    );
  });

  it('returns null when missing', () => {
    expect(parseCookieHeader('a=1', REFRESH_COOKIE)).toBeNull();
    expect(parseCookieHeader(undefined, REFRESH_COOKIE)).toBeNull();
  });
});
