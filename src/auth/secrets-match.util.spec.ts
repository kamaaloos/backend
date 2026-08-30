import { secretsMatch } from './secrets-match.util';

describe('secretsMatch', () => {
  it('accepts equal values', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true);
  });

  it('rejects mismatches and empties', () => {
    expect(secretsMatch('abc', 'abd')).toBe(false);
    expect(secretsMatch('abc', 'ab')).toBe(false);
    expect(secretsMatch('', 'abc')).toBe(false);
    expect(secretsMatch('abc', '')).toBe(false);
    expect(secretsMatch(null, 'abc')).toBe(false);
  });
});
