import { describe, it, expect } from 'vitest';
import { parseCookie, formatAuthCookie, clearAuthCookie } from '../src/cookie.js';

describe('cookie helpers', () => {
  it('parses a single cookie header', () => {
    expect(parseCookie('Auth=abc.def.ghi')).toEqual({ Auth: 'abc.def.ghi' });
  });

  it('parses multiple cookies', () => {
    expect(parseCookie('a=1; b=2; Auth=xyz')).toEqual({ a: '1', b: '2', Auth: 'xyz' });
  });

  it('returns {} for null header', () => {
    expect(parseCookie(null)).toEqual({});
  });

  it('formats auth cookie with required flags', () => {
    const c = formatAuthCookie('jwt.value');
    expect(c).toContain('Auth=jwt.value');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=None');
    expect(c).toContain('Path=/');
    expect(c).toContain('Max-Age=28800');
  });

  it('clearAuthCookie produces Max-Age=0', () => {
    expect(clearAuthCookie()).toContain('Max-Age=0');
  });
});
