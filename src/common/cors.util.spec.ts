import { buildCorsOptions, isCorsOriginAllowed } from './cors.util';

describe('buildCorsOptions', () => {
  it('allows all origins in dev when CORS_ORIGIN is unset', () => {
    const opts = buildCorsOptions({ isProd: false });
    expect(opts.origin).toBe(true);
  });

  it('requires CORS_ORIGIN or preview flag in production', () => {
    expect(() => buildCorsOptions({ isProd: true })).toThrow(/CORS_ORIGIN/);
  });

  it('allows explicit origins', () => {
    const opts = buildCorsOptions({
      corsOrigin: 'https://customer.example.com,https://admin.example.com',
    });
    expect(opts.origin).toEqual([
      'https://customer.example.com',
      'https://admin.example.com',
    ]);
  });

  it('allows vercel.app previews when flag is on', () => {
    const opts = buildCorsOptions({
      corsOrigin: 'https://customer.example.com',
      allowVercelPreviews: '1',
    });
    expect(typeof opts.origin).toBe('function');

    const originFn = opts.origin as (
      origin: string | undefined,
      cb: (err: Error | null, ok?: boolean) => void,
    ) => void;

    originFn('https://customer-git-main-acme.vercel.app', (err, ok) => {
      expect(err).toBeNull();
      expect(ok).toBe(true);
    });

    originFn('https://evil.example.com', (err, ok) => {
      expect(err).toBeInstanceOf(Error);
      expect(ok).toBe(false);
    });
  });

  it('allows wildcard tenant hosts in CORS_ORIGIN', () => {
    const opts = buildCorsOptions({
      corsOrigin:
        'https://admin.maylesoft.com,https://*.maylesoft.com,https://maylesoft.com',
    });
    expect(typeof opts.origin).toBe('function');

    const originFn = opts.origin as (
      origin: string | undefined,
      cb: (err: Error | null, ok?: boolean) => void,
    ) => void;

    originFn('https://alhuda.maylesoft.com', (err, ok) => {
      expect(err).toBeNull();
      expect(ok).toBe(true);
    });

    originFn('https://hkamal.maylesoft.com', (err, ok) => {
      expect(err).toBeNull();
      expect(ok).toBe(true);
    });

    originFn('https://admin.maylesoft.com', (err, ok) => {
      expect(err).toBeNull();
      expect(ok).toBe(true);
    });

    originFn('https://evil.example.com', (err, ok) => {
      expect(err).toBeInstanceOf(Error);
      expect(ok).toBe(false);
    });
  });

  it('rejects multi-level subdomain abuse against single * wildcard', () => {
    expect(
      isCorsOriginAllowed('https://evil.alhuda.maylesoft.com', {
        corsOrigin: 'https://*.maylesoft.com',
      }),
    ).toBe(false);
  });
});

describe('isCorsOriginAllowed', () => {
  it('matches Socket.IO-relevant browser origins for maylesoft tenants', () => {
    const policy = {
      corsOrigin:
        'https://admin.maylesoft.com,https://kitchen.maylesoft.com,https://*.maylesoft.com,https://maylesoft.com',
    };

    expect(isCorsOriginAllowed('https://alhuda.maylesoft.com', policy)).toBe(
      true,
    );
    expect(isCorsOriginAllowed('https://customer.maylesoft.com', policy)).toBe(
      true,
    );
    expect(isCorsOriginAllowed('https://phishing.com', policy)).toBe(false);
  });
});
